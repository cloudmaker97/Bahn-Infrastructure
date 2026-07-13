// Selftest for the departures normalization and the DeparturesService.
// Completely OFFLINE: upstream is simulated via an injected fake fetch function.
// Run with: npx tsx src/data/departures.selftest.ts
import assert from 'node:assert';
import { DeparturesService, normalizeDepartures } from './departures-service.js';

/** Raw StopTime shaped like the Transitous stoptimes response (only used fields). */
function stopTime(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    place: {
      name: 'Hamburg Hbf',
      departure: '2026-07-13T12:05:00Z',
      scheduledDeparture: '2026-07-13T12:00:00Z',
      track: '8',
      scheduledTrack: '7',
    },
    mode: 'HIGHSPEED_RAIL',
    realTime: true,
    headsign: 'München Hbf',
    displayName: 'ICE 577',
    tripId: 'trip-1',
    cancelled: false,
    tripCancelled: false,
    ...over,
  };
}

// --- a) normalizeDepartures: field mapping, delay, category, rail filter ---
{
  const raw = {
    place: { name: 'Hamburg Hbf' },
    stopTimes: [
      stopTime(),
      stopTime({ mode: 'BUS', displayName: 'Bus 5' }), // not railway -> discarded
    ],
  };
  const r = normalizeDepartures(raw)!;
  assert.ok(r, 'usable response -> result');
  assert.strictEqual(r.stationName, 'Hamburg Hbf', 'station name from place');
  assert.strictEqual(r.departures.length, 1, `bus discarded: 1 departure, got ${r.departures.length}`);
  const d = r.departures[0]!;
  assert.strictEqual(d.name, 'ICE 577', 'display name');
  assert.strictEqual(d.headsign, 'München Hbf', 'headsign');
  assert.strictEqual(d.category, 'long-distance', 'category from the mode');
  assert.strictEqual(d.departMs, Date.parse('2026-07-13T12:05:00Z'), 'realtime departure in ms');
  assert.strictEqual(d.schedDepartMs, Date.parse('2026-07-13T12:00:00Z'), 'scheduled departure in ms');
  assert.strictEqual(d.delayMin, 5, 'delay in minutes');
  assert.strictEqual(d.track, '8', 'realtime track');
  assert.strictEqual(d.scheduledTrack, '7', 'scheduled track');
  assert.strictEqual(d.realTime, true, 'realTime carried over');
  assert.strictEqual(d.cancelled, false, 'not cancelled');
  assert.strictEqual(d.stopName, 'Hamburg Hbf', 'stop name carried over');
}

// --- b) cancelled events + scheduled-time fallback ---
{
  const raw = {
    place: { name: 'X' },
    stopTimes: [
      // Cancelled with tripCancelled only, departure missing -> scheduled fallback.
      stopTime({
        tripCancelled: true,
        place: { name: 'X', scheduledDeparture: '2026-07-13T13:00:00Z' },
      }),
      // Cancelled via the stop-level flag.
      stopTime({ cancelled: true }),
      // No time at all -> discarded.
      stopTime({ place: { name: 'X' } }),
    ],
  };
  const r = normalizeDepartures(raw)!;
  assert.strictEqual(r.departures.length, 2, `timeless event discarded: got ${r.departures.length}`);
  const [a, b] = r.departures;
  assert.strictEqual(a!.cancelled, true, 'stop-level cancelled flag');
  assert.strictEqual(b!.cancelled, true, 'tripCancelled counts as cancelled');
  assert.strictEqual(b!.departMs, Date.parse('2026-07-13T13:00:00Z'), 'scheduled fallback for departMs');
  assert.strictEqual(b!.delayMin, 0, 'fallback: no phantom delay');
}

// --- c) sorted by (realtime) departure ---
{
  const raw = {
    place: { name: 'X' },
    stopTimes: [
      stopTime({ tripId: 'later', place: { name: 'X', departure: '2026-07-13T12:30:00Z' } }),
      stopTime({ tripId: 'earlier', place: { name: 'X', departure: '2026-07-13T12:10:00Z' } }),
    ],
  };
  const r = normalizeDepartures(raw)!;
  assert.deepStrictEqual(r.departures.map((d) => d.tripId), ['earlier', 'later'], 'sorted by departMs');
}

// --- c2) per-feed duplicates are merged (realtime + track survive) ---
{
  const raw = {
    place: { name: 'center' }, // center+radius query: anchor, not a station name
    stopTimes: [
      // Feed 1: realtime, no track, feed suffix in the name.
      stopTime({
        displayName: 'RB31 (81647)', mode: 'REGIONAL_RAIL', headsign: 'Uelzen', tripId: '',
        realTime: true,
        place: { name: 'Hamburg Hbf', departure: '2026-07-13T12:07:00Z', scheduledDeparture: '2026-07-13T12:05:00Z' },
      }),
      // Feed 2: schedule-only, with the track.
      stopTime({
        displayName: 'RB31', mode: 'REGIONAL_RAIL', headsign: 'Uelzen', tripId: 'trip-rb31',
        realTime: false,
        place: { name: 'Hamburg Hbf', departure: '2026-07-13T12:05:00Z', scheduledDeparture: '2026-07-13T12:05:00Z', track: '12' },
      }),
    ],
  };
  const r = normalizeDepartures(raw)!;
  assert.strictEqual(r.stationName, '', 'anchor place "center" is not a station name');
  assert.strictEqual(r.departures.length, 1, `duplicates merged: got ${r.departures.length}`);
  const d = r.departures[0]!;
  assert.strictEqual(d.name, 'RB31', 'shorter name (no feed suffix) wins');
  assert.strictEqual(d.realTime, true, 'realtime survives the merge');
  assert.strictEqual(d.departMs, Date.parse('2026-07-13T12:07:00Z'), 'realtime departure survives');
  assert.strictEqual(d.delayMin, 2, 'delay from the realtime feed');
  assert.strictEqual(d.track, '12', 'track from the schedule feed survives');
  assert.strictEqual(d.tripId, 'trip-rb31', 'tripId filled from the duplicate');
}

// --- d) unusable input -> null; empty stopTimes -> valid empty result ---
{
  assert.strictEqual(normalizeDepartures(null), null, 'null -> null');
  assert.strictEqual(normalizeDepartures({}), null, 'no stopTimes -> null');
  assert.strictEqual(normalizeDepartures('garbage'), null, 'garbage -> null');
  const empty = normalizeDepartures({ place: { name: 'X' }, stopTimes: [] })!;
  assert.ok(empty, 'empty stopTimes is a valid result');
  assert.deepStrictEqual(empty.departures, [], 'no departures');
}

// --- e) DeparturesService: URL, coordinate cache, error path, invalid coords ---
{
  const rawResponse = { place: { name: 'Hamburg Hbf' }, stopTimes: [stopTime()] };
  const urls: string[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return new Response(JSON.stringify(rawResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const svc = new DeparturesService({ fetchFn: fakeFetch });
  const r1 = await svc.getDepartures(53.552736, 10.006909);
  assert.strictEqual(r1.error, null, `error must be null: ${r1.error}`);
  assert.strictEqual(r1.stationName, 'Hamburg Hbf', 'normalized station name');
  assert.strictEqual(r1.departures.length, 1, 'normalized departures');
  assert.strictEqual(urls.length, 1, 'exactly 1 upstream call');

  // The URL carries the spatial resolution and the fixed query parameters.
  const u = new URL(urls[0]!);
  assert.strictEqual(u.searchParams.get('center'), '53.55274,10.00691', 'center = lat,lon (5 decimals)');
  assert.strictEqual(u.searchParams.get('radius'), '500', 'radius=500');
  assert.strictEqual(u.searchParams.get('n'), '20', 'n=20 (headroom for deduping)');
  assert.strictEqual(u.searchParams.get('arriveBy'), 'false', 'arriveBy=false');
  assert.ok(u.searchParams.get('mode')!.includes('HIGHSPEED_RAIL'), 'railway mode filter');
  assert.ok(!u.searchParams.get('mode')!.includes('BUS'), 'no bus mode');
  assert.strictEqual(u.searchParams.get('language'), 'de', 'language=de');

  // Burst cache: nearby coordinate (same ~10 m bucket) -> NO further upstream call.
  const r2 = await svc.getDepartures(53.552739, 10.006901);
  assert.strictEqual(urls.length, 1, 'cache hit: still 1 upstream call');
  assert.strictEqual(r2, r1, 'the cache returns the same result object');

  // Different station -> own cache entry -> second upstream call.
  await svc.getDepartures(48.140364, 11.558744);
  assert.strictEqual(urls.length, 2, 'different station: 2nd upstream call');

  // Invalid coordinates -> error result WITHOUT an upstream call.
  const rBad = await svc.getDepartures(Number.NaN, 10);
  assert.ok(rBad.error, 'invalid coordinates -> error set');
  assert.deepStrictEqual(rBad.departures, [], 'invalid coordinates -> no departures');
  const rRange = await svc.getDepartures(91, 10);
  assert.ok(rRange.error, 'out-of-range latitude -> error set');
  assert.strictEqual(urls.length, 2, 'invalid coordinates: no upstream call');

  // Error path: throwing fetch -> error set, no throw; negative caching.
  {
    let calls = 0;
    const broken = (async () => {
      calls++;
      throw new Error('Netz weg');
    }) as unknown as typeof fetch;
    const svcError = new DeparturesService({ fetchFn: broken });
    const rf = await svcError.getDepartures(50, 8);
    assert.deepStrictEqual(rf.departures, [], 'error case: no departures');
    assert.ok(rf.error && rf.error.includes('Netz weg'), `error text expected: ${rf.error}`);
    await svcError.getDepartures(50, 8);
    assert.strictEqual(calls, 1, 'negative caching: only 1 upstream call despite 2 requests');
  }

  // Unusable upstream JSON (no stopTimes) -> error result, no throw.
  {
    const emptyJson = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const svcEmpty = new DeparturesService({ fetchFn: emptyJson });
    const re = await svcEmpty.getDepartures(50, 8);
    assert.ok(re.error, 'unusable response -> error set');
    assert.deepStrictEqual(re.departures, [], 'unusable response -> no departures');
  }
}

console.log('departures selftest: OK');
