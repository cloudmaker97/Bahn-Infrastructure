// Selftest for the live-train core logic (src/shared) and the LiveTripsService.
// Completely OFFLINE: upstream is simulated via an injected fake fetch function.
// Run with: npx tsx src/data/live-trips.selftest.ts
import assert from 'node:assert';
import { decodePolyline, type LatLon } from '../shared/polyline.js';
import { buildTrack, positionAt, type Ring } from '../shared/geo.js';
import { isRailMode, categoryOf, matchesTrainQuery, normalizeTrips } from '../shared/live-trips-core.js';
import { DE_BOUNDARY_RINGS } from '../shared/de-boundary.js';
import { LiveTripsService } from './live-trips-service.js';

// --- Test helper: ENCODE a Google encoded polyline (inverse of decodePolyline) ---
function encodePolyline(points: LatLon[], precision = 5): string {
  const f = Math.pow(10, precision);
  const encodeValue = (v: number): string => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const [lat, lon] of points) {
    const latE = Math.round(lat * f);
    const lonE = Math.round(lon * f);
    out += encodeValue(latE - prevLat) + encodeValue(lonE - prevLon);
    prevLat = latE;
    prevLon = lonE;
  }
  return out;
}

/** Compares two numbers with a tolerance. */
function near(actual: number, expected: number, tol: number, msg: string): void {
  assert.ok(Math.abs(actual - expected) < tol, `${msg}: actual=${actual}, expected=${expected}`);
}

// --- a) decodePolyline: official Google test vector ---
{
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.strictEqual(pts.length, 3, `test vector: ${pts.length} points`);
  const expected: LatLon[] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];
  for (let i = 0; i < expected.length; i++) {
    near(pts[i]![0], expected[i]![0], 1e-6, `point ${i} lat`);
    near(pts[i]![1], expected[i]![1], 1e-6, `point ${i} lon`);
  }
  // Roundtrip: the selftest encoder must be the inverse of the decoder.
  assert.strictEqual(encodePolyline(expected), '_p~iF~ps|U_ulLnnqC_mqNvxq`@', 'encoder hits the test vector');
  const rt = decodePolyline(encodePolyline(expected));
  for (let i = 0; i < expected.length; i++) {
    near(rt[i]![0], expected[i]![0], 1e-5, `roundtrip ${i} lat`);
    near(rt[i]![1], expected[i]![1], 1e-5, `roundtrip ${i} lon`);
  }
}

// --- b) buildTrack/positionAt: interpolation + clamping ---
{
  const track = buildTrack([
    [0, 0],
    [0, 10],
  ]);
  near(track.total, 10, 1e-9, 'total length');
  assert.deepStrictEqual(positionAt(track, 0), [0, 0], 'frac=0 -> start');
  const middle = positionAt(track, 0.5)!;
  near(middle[0], 0, 1e-9, 'frac=0.5 lat');
  near(middle[1], 5, 1e-9, 'frac=0.5 lon');
  assert.deepStrictEqual(positionAt(track, 1), [0, 10], 'frac=1 -> end');
  // Clamping to [0, 1].
  assert.deepStrictEqual(positionAt(track, -0.5), [0, 0], 'frac<0 -> start');
  assert.deepStrictEqual(positionAt(track, 1.5), [0, 10], 'frac>1 -> end');
}

// --- c) isRailMode/categoryOf ---
{
  assert.strictEqual(isRailMode('HIGHSPEED_RAIL'), true, 'HIGHSPEED_RAIL is railway');
  assert.strictEqual(categoryOf('HIGHSPEED_RAIL'), 'long-distance', 'HIGHSPEED_RAIL -> long-distance');
  assert.strictEqual(isRailMode('SUBURBAN'), true, 'SUBURBAN is railway');
  assert.strictEqual(categoryOf('SUBURBAN'), 'suburban', 'SUBURBAN -> suburban');
  assert.strictEqual(isRailMode('BUS'), false, 'BUS is not railway');
}

// --- d) matchesTrainQuery: full name, train number, no partial matches ---
{
  assert.ok(matchesTrainQuery('ICE 577', 'ICE 577'), 'exact name matches');
  assert.ok(matchesTrainQuery('ICE 577', 'ice577'), 'case- and space-insensitive');
  assert.ok(matchesTrainQuery('ICE 577', '577'), 'train number alone matches');
  assert.ok(matchesTrainQuery('S 3', 's3'), 'short suburban name matches');
  assert.ok(matchesTrainQuery('RE 5', '5'), 'single-digit train number matches');
  assert.ok(!matchesTrainQuery('ICE 1577', '577'), 'number must match completely (no suffix match)');
  assert.ok(!matchesTrainQuery('ICE 577', 'ICE 57'), 'no name prefix match');
  assert.ok(!matchesTrainQuery('ICE 577', 'ICE'), 'category alone does not match');
  assert.ok(!matchesTrainQuery('', '577'), 'empty name never matches');
  assert.ok(!matchesTrainQuery('ICE 577', '   '), 'blank query never matches');
}

// --- e) normalizeTrips: filters (mode, times, polyline) + DE boundary filter ---
{
  // Track with 2 points in Germany; now = mid-journey -> position ~[52.35, 10.2].
  const polyDe = encodePolyline([
    [52.4, 10.7],
    [52.3, 9.7],
  ]);
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const departMs = nowMs - 10 * 60_000;
  const arriveMs = nowMs + 10 * 60_000;
  const schedDepartMs = departMs - 3 * 60_000; // departed 3 min late

  const valid = {
    mode: 'HIGHSPEED_RAIL',
    departure: new Date(departMs).toISOString(),
    arrival: new Date(arriveMs).toISOString(),
    scheduledDeparture: new Date(schedDepartMs).toISOString(),
    scheduledArrival: new Date(arriveMs - 3 * 60_000).toISOString(),
    realTime: true,
    polyline: polyDe,
    from: { name: 'Wolfsburg Hbf' },
    to: { name: 'Hannover Hbf' },
    trips: [{ tripId: 'trip-1', displayName: 'ICE 123' }],
  };
  const fixture = [
    { ...valid, mode: 'BUS' }, // not a railway mode -> dropped
    valid, // kept
    { ...valid, arrival: valid.departure }, // arrival <= departure -> dropped
    { ...valid, polyline: '' }, // empty polyline -> dropped
  ];

  const trains = normalizeTrips(fixture, nowMs, DE_BOUNDARY_RINGS);
  assert.strictEqual(trains.length, 1, `normalizeTrips: ${trains.length} instead of 1`);
  const t = trains[0]!;
  assert.strictEqual(t.name, 'ICE 123', 'display name from trips[0]');
  assert.strictEqual(t.tripId, 'trip-1', 'raw tripId carried over (key for /api/trip)');
  assert.strictEqual(t.category, 'long-distance', 'category long-distance');
  assert.strictEqual(t.delayMin, 3, `delayMin: ${t.delayMin}`);
  assert.strictEqual(t.realTime, true, 'realTime carried over');
  assert.strictEqual(t.polyline, polyDe, 'polyline stays encoded');
  assert.strictEqual(t.fromName, 'Wolfsburg Hbf');
  assert.strictEqual(t.toName, 'Hannover Hbf');

  // Boundary filter: with a square ring far away (around [0, 0]) the train is dropped.
  const farRing: Ring[] = [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ];
  assert.strictEqual(normalizeTrips(fixture, nowMs, farRing).length, 0, 'position outside -> dropped');
}

// --- f) LiveTripsService: fake fetch (cache per bucket, error path, DE bbox in the URL) ---
{
  const nowMs = Date.now();
  const segment = {
    mode: 'REGIONAL_RAIL',
    departure: new Date(nowMs - 60_000).toISOString(),
    arrival: new Date(nowMs + 60_000).toISOString(),
    scheduledDeparture: new Date(nowMs - 60_000).toISOString(),
    scheduledArrival: new Date(nowMs + 60_000).toISOString(),
    realTime: false,
    polyline: encodePolyline([
      [52.4, 10.7],
      [52.3, 9.7],
    ]),
    from: { name: 'Wolfsburg Hbf' },
    to: { name: 'Hannover Hbf' },
    trips: [{ tripId: 'trip-re', displayName: 'RE 30' }],
  };
  const urls: string[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return new Response(JSON.stringify([segment]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const svc = new LiveTripsService({ fetchFn: fakeFetch });
  const r1 = await svc.getTrains(6);
  assert.strictEqual(r1.error, null, `error must be null: ${r1.error}`);
  assert.strictEqual(r1.trains.length, 1, `service: ${r1.trains.length} trains instead of 1`);
  assert.strictEqual(urls.length, 1, 'exactly 1 upstream call');

  // Burst cache: an immediate second call for the same bucket -> NO further upstream call.
  const r2 = await svc.getTrains(6);
  assert.strictEqual(urls.length, 1, 'cache hit: still 1 upstream call');
  assert.strictEqual(r2, r1, 'the cache returns the same result object');

  // Different zoom bucket -> own cache entry -> second upstream call.
  await svc.getTrains(7);
  assert.strictEqual(urls.length, 2, 'different bucket: 2nd upstream call');

  // Zoom clamping: 20 -> bucket 8 (Transitous: 422 for the DE bbox and zoom > 8).
  await svc.getTrains(20);
  assert.strictEqual(urls.length, 3, 'clamped bucket: 3rd upstream call');
  assert.strictEqual(new URL(urls[2]!).searchParams.get('zoom'), '8', 'zoom clamped to 8');
  // 9 also clamps to 8 -> cache hit, no further upstream call.
  await svc.getTrains(9);
  assert.strictEqual(urls.length, 3, 'zoom 9 -> bucket 8 from the cache');

  // The URL contains the Germany bbox (min~47.2,5.8; max~55.1,15.1) + bucket.
  const u = new URL(urls[0]!);
  assert.strictEqual(u.searchParams.get('zoom'), '6', 'zoom=6 in the URL');
  const min = (u.searchParams.get('min') ?? '').split(',').map(Number);
  const max = (u.searchParams.get('max') ?? '').split(',').map(Number);
  assert.strictEqual(min.length, 2, 'min=lat,lon');
  assert.strictEqual(max.length, 2, 'max=lat,lon');
  near(min[0]!, 47.2, 0.3, 'min lat (DE south)');
  near(min[1]!, 5.8, 0.3, 'min lon (DE west)');
  near(max[0]!, 55.1, 0.3, 'max lat (DE north)');
  near(max[1]!, 15.1, 0.3, 'max lon (DE east)');
  assert.ok(u.searchParams.get('startTime'), 'startTime set');
  assert.ok(u.searchParams.get('endTime'), 'endTime set');

  // Error path: ttlMs=0 (cache off) + throwing fetch -> error set, trains empty, NO throw.
  const broken = (async () => {
    throw new Error('Netz weg');
  }) as unknown as typeof fetch;
  const svcError = new LiveTripsService({ ttlMs: 0, fetchFn: broken });
  const rf = await svcError.getTrains(6);
  assert.deepStrictEqual(rf.trains, [], 'error case: no trains');
  assert.ok(rf.error && rf.error.includes('Netz weg'), `error text expected: ${rf.error}`);

  // Negative caching: error results keep the burst protection alive too.
  {
    let calls = 0;
    const alwaysBroken = (async () => {
      calls++;
      throw new Error('Upstream down');
    }) as unknown as typeof fetch;
    const svcNeg = new LiveTripsService({ ttlMs: 60_000, fetchFn: alwaysBroken });
    const e1 = await svcNeg.getTrains(6);
    const e2 = await svcNeg.getTrains(6);
    assert.strictEqual(calls, 1, 'negative caching: only 1 upstream call despite 2 requests');
    assert.ok(e1.error && e2.error, 'both responses carry the error');
  }

  // Single flight: parallel requests for the same bucket share ONE upstream call.
  {
    let calls = 0;
    const slow = (async () => {
      calls++;
      await new Promise((f) => setTimeout(f, 25));
      return new Response(JSON.stringify([segment]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const svcSf = new LiveTripsService({ fetchFn: slow });
    const [p1, p2] = await Promise.all([svcSf.getTrains(6), svcSf.getTrains(6)]);
    assert.strictEqual(calls, 1, 'single flight: 1 upstream call for 2 parallel requests');
    assert.strictEqual(p1, p2, 'both callers receive the same result object');
  }
}

console.log('live-trips selftest: OK');
