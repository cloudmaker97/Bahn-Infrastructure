// Selftest for the trip-details normalization and the TripDetailsService.
// Completely OFFLINE: upstream is simulated via an injected fake fetch function.
// Run with: npx tsx src/data/trip-details.selftest.ts
import assert from 'node:assert';
import { normalizeTripDetails, TripDetailsService } from './trip-details-service.js';

/** Raw place shaped like the Transitous trip response (only the used fields). */
function place(name: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, cancelled: false, ...opts };
}

// --- a) normalizeTripDetails: single leg (from + intermediates + to) ---
{
  const raw = {
    legs: [{
      displayName: 'ICE 1032',
      headsign: 'Greifswald',
      realTime: true,
      from: place('Hamburg-Altona', {
        departure: '2026-07-10T14:55:00Z', scheduledDeparture: '2026-07-10T14:55:00Z',
      }),
      intermediateStops: [
        place('Hamburg Hbf', {
          arrival: '2026-07-10T15:06:00Z', scheduledArrival: '2026-07-10T15:04:00Z',
          departure: '2026-07-10T15:08:00Z', scheduledDeparture: '2026-07-10T15:08:00Z',
          track: '5',
        }),
      ],
      to: place('Greifswald', {
        arrival: '2026-07-10T18:18:00Z', scheduledArrival: '2026-07-10T18:18:00Z', track: '2',
      }),
    }],
  };
  const trip = normalizeTripDetails(raw)!;
  assert.ok(trip, 'usable leg -> result');
  assert.strictEqual(trip.name, 'ICE 1032', 'display name from the leg');
  assert.strictEqual(trip.headsign, 'Greifswald', 'headsign carried over');
  assert.strictEqual(trip.realTime, true, 'realTime carried over');
  assert.strictEqual(trip.stops.length, 3, `3 stops, got ${trip.stops.length}`);

  const [first, mid, last] = trip.stops;
  assert.strictEqual(first!.name, 'Hamburg-Altona');
  assert.strictEqual(first!.arriveMs, null, 'origin has no arrival');
  assert.strictEqual(first!.departMs, Date.parse('2026-07-10T14:55:00Z'), 'origin departure in ms');
  assert.strictEqual(mid!.arriveMs, Date.parse('2026-07-10T15:06:00Z'), 'intermediate arrival in ms');
  assert.strictEqual(mid!.schedArriveMs, Date.parse('2026-07-10T15:04:00Z'), 'scheduled arrival kept (delay!)');
  assert.strictEqual(mid!.track, '5', 'track carried over');
  assert.strictEqual(last!.name, 'Greifswald');
  assert.strictEqual(last!.departMs, null, 'destination has no departure');
}

// --- b) normalizeTripDetails: leg seam is merged into ONE stop ---
{
  const raw = {
    legs: [
      {
        displayName: 'RE 5', realTime: false,
        from: place('A', { departure: '2026-07-10T10:00:00Z' }),
        to: place('B', { arrival: '2026-07-10T10:30:00Z' }),
      },
      {
        headsign: 'C-Stadt', realTime: false,
        from: place('B', { departure: '2026-07-10T10:35:00Z', track: '7' }),
        to: place('C', { arrival: '2026-07-10T11:00:00Z' }),
      },
    ],
  };
  const trip = normalizeTripDetails(raw)!;
  assert.strictEqual(trip.stops.length, 3, `seam merged: 3 stops, got ${trip.stops.length}`);
  const seam = trip.stops[1]!;
  assert.strictEqual(seam.name, 'B');
  assert.strictEqual(seam.arriveMs, Date.parse('2026-07-10T10:30:00Z'), 'arrival from leg 1');
  assert.strictEqual(seam.departMs, Date.parse('2026-07-10T10:35:00Z'), 'departure from leg 2');
  assert.strictEqual(seam.track, '7', 'track merged from the continuation');
  assert.strictEqual(trip.headsign, 'C-Stadt', 'headsign from the last leg');
}

// --- c) normalizeTripDetails: unusable input -> null ---
{
  assert.strictEqual(normalizeTripDetails(null), null, 'null -> null');
  assert.strictEqual(normalizeTripDetails({}), null, 'no legs -> null');
  assert.strictEqual(normalizeTripDetails({ legs: [] }), null, 'empty legs -> null');
  assert.strictEqual(normalizeTripDetails('garbage'), null, 'garbage -> null');
}

// --- d) TripDetailsService: cache per tripId, error path, URL, empty tripId ---
{
  const rawTrip = {
    legs: [{
      displayName: 'ICE 1032', headsign: 'Greifswald', realTime: true,
      from: place('Hamburg-Altona', { departure: '2026-07-10T14:55:00Z' }),
      to: place('Greifswald', { arrival: '2026-07-10T18:18:00Z' }),
    }],
  };
  const urls: string[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return new Response(JSON.stringify(rawTrip), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const svc = new TripDetailsService({ fetchFn: fakeFetch });
  const tripId = '20260710_16:55_de-DELFI_3279222190';
  const r1 = await svc.getTrip(tripId);
  assert.strictEqual(r1.error, null, `error must be null: ${r1.error}`);
  assert.strictEqual(r1.name, 'ICE 1032', 'normalized name');
  assert.strictEqual(r1.stops.length, 2, 'normalized stops');
  assert.strictEqual(urls.length, 1, 'exactly 1 upstream call');

  // The URL carries the encoded tripId and the fixed query parameters.
  const u = new URL(urls[0]!);
  assert.strictEqual(u.searchParams.get('tripId'), tripId, 'tripId in the URL (encoded roundtrip)');
  assert.strictEqual(u.searchParams.get('joinInterlinedLegs'), 'false', 'joinInterlinedLegs=false');
  assert.strictEqual(u.searchParams.get('language'), 'de', 'language=de');

  // Burst cache: an immediate second call for the same trip -> NO further upstream call.
  const r2 = await svc.getTrip(tripId);
  assert.strictEqual(urls.length, 1, 'cache hit: still 1 upstream call');
  assert.strictEqual(r2, r1, 'the cache returns the same result object');

  // Different tripId -> own cache entry -> second upstream call.
  await svc.getTrip('other-trip');
  assert.strictEqual(urls.length, 2, 'different trip: 2nd upstream call');

  // Empty tripId -> error result WITHOUT an upstream call.
  const rEmpty = await svc.getTrip('');
  assert.ok(rEmpty.error, 'empty tripId -> error set');
  assert.deepStrictEqual(rEmpty.stops, [], 'empty tripId -> no stops');
  assert.strictEqual(urls.length, 2, 'empty tripId: no upstream call');

  // Error path: throwing fetch -> error set, stops empty, NO throw; negative caching.
  {
    let calls = 0;
    const broken = (async () => {
      calls++;
      throw new Error('Netz weg');
    }) as unknown as typeof fetch;
    const svcError = new TripDetailsService({ fetchFn: broken });
    const rf = await svcError.getTrip('x');
    assert.deepStrictEqual(rf.stops, [], 'error case: no stops');
    assert.ok(rf.error && rf.error.includes('Netz weg'), `error text expected: ${rf.error}`);
    await svcError.getTrip('x');
    assert.strictEqual(calls, 1, 'negative caching: only 1 upstream call despite 2 requests');
  }

  // Unusable upstream JSON (no legs) -> error result, no throw.
  {
    const emptyJson = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const svcEmpty = new TripDetailsService({ fetchFn: emptyJson });
    const re = await svcEmpty.getTrip('y');
    assert.ok(re.error, 'unusable response -> error set');
    assert.deepStrictEqual(re.stops, [], 'unusable response -> no stops');
  }
}

console.log('trip-details selftest: OK');
