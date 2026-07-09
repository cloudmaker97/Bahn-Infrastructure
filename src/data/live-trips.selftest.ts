// Selbsttest für die Live-Zug-Kernlogik (src/shared) und den LiveTripsService.
// Komplett OFFLINE: Upstream wird über eine injizierte Fake-fetch-Funktion simuliert.
// Laufbar mit: npx tsx src/data/live-trips.selftest.ts
import assert from 'node:assert';
import { decodePolyline, type LatLon } from '../shared/polyline.js';
import { buildTrack, positionAt, type Ring } from '../shared/geo.js';
import { isRailMode, categoryOf, normalizeTrips } from '../shared/live-trips-core.js';
import { DE_BOUNDARY_RINGS } from '../shared/de-boundary.js';
import { LiveTripsService } from './live-trips-service.js';

// --- Test-Helfer: Google-Encoded-Polyline KODIEREN (Umkehrung von decodePolyline) ---
function encodePolyline(points: LatLon[], precision = 5): string {
  const f = Math.pow(10, precision);
  const encodeWert = (v: number): string => {
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
    out += encodeWert(latE - prevLat) + encodeWert(lonE - prevLon);
    prevLat = latE;
    prevLon = lonE;
  }
  return out;
}

/** Vergleicht zwei Zahlen mit Toleranz. */
function nahe(ist: number, soll: number, tol: number, msg: string): void {
  assert.ok(Math.abs(ist - soll) < tol, `${msg}: ist=${ist}, soll=${soll}`);
}

// --- a) decodePolyline: offizieller Google-Testvektor ---
{
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.strictEqual(pts.length, 3, `Testvektor: ${pts.length} Punkte`);
  const soll: LatLon[] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];
  for (let i = 0; i < soll.length; i++) {
    nahe(pts[i]![0], soll[i]![0], 1e-6, `Punkt ${i} lat`);
    nahe(pts[i]![1], soll[i]![1], 1e-6, `Punkt ${i} lon`);
  }
  // Roundtrip: der Selftest-Encoder muss die Umkehrung des Decoders sein.
  assert.strictEqual(encodePolyline(soll), '_p~iF~ps|U_ulLnnqC_mqNvxq`@', 'Encoder trifft den Testvektor');
  const rt = decodePolyline(encodePolyline(soll));
  for (let i = 0; i < soll.length; i++) {
    nahe(rt[i]![0], soll[i]![0], 1e-5, `Roundtrip ${i} lat`);
    nahe(rt[i]![1], soll[i]![1], 1e-5, `Roundtrip ${i} lon`);
  }
}

// --- b) buildTrack/positionAt: Interpolation + Klemmung ---
{
  const track = buildTrack([
    [0, 0],
    [0, 10],
  ]);
  nahe(track.total, 10, 1e-9, 'Gesamtlänge');
  assert.deepStrictEqual(positionAt(track, 0), [0, 0], 'frac=0 -> Start');
  const mitte = positionAt(track, 0.5)!;
  nahe(mitte[0], 0, 1e-9, 'frac=0.5 lat');
  nahe(mitte[1], 5, 1e-9, 'frac=0.5 lon');
  assert.deepStrictEqual(positionAt(track, 1), [0, 10], 'frac=1 -> Ende');
  // Klemmung auf [0, 1].
  assert.deepStrictEqual(positionAt(track, -0.5), [0, 0], 'frac<0 -> Start');
  assert.deepStrictEqual(positionAt(track, 1.5), [0, 10], 'frac>1 -> Ende');
}

// --- c) isRailMode/categoryOf ---
{
  assert.strictEqual(isRailMode('HIGHSPEED_RAIL'), true, 'HIGHSPEED_RAIL ist Eisenbahn');
  assert.strictEqual(categoryOf('HIGHSPEED_RAIL'), 'fern', 'HIGHSPEED_RAIL -> fern');
  assert.strictEqual(isRailMode('SUBURBAN'), true, 'SUBURBAN ist Eisenbahn');
  assert.strictEqual(categoryOf('SUBURBAN'), 'sbahn', 'SUBURBAN -> sbahn');
  assert.strictEqual(isRailMode('BUS'), false, 'BUS ist keine Eisenbahn');
}

// --- d) normalizeTrips: Filter (Modus, Zeiten, Polyline) + DE-Grenzfilter ---
{
  // Fahrweg mit 2 Punkten in Deutschland; now = Fahrt-Mitte -> Position ~[52.35, 10.2].
  const polyDe = encodePolyline([
    [52.4, 10.7],
    [52.3, 9.7],
  ]);
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const departMs = nowMs - 10 * 60_000;
  const arriveMs = nowMs + 10 * 60_000;
  const schedDepartMs = departMs - 3 * 60_000; // 3 min verspätet abgefahren

  const gueltig = {
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
    { ...gueltig, mode: 'BUS' }, // kein Eisenbahn-Modus -> raus
    gueltig, // bleibt
    { ...gueltig, arrival: gueltig.departure }, // arrival <= departure -> raus
    { ...gueltig, polyline: '' }, // leere Polyline -> raus
  ];

  const trains = normalizeTrips(fixture, nowMs, DE_BOUNDARY_RINGS);
  assert.strictEqual(trains.length, 1, `normalizeTrips: ${trains.length} statt 1`);
  const t = trains[0]!;
  assert.strictEqual(t.name, 'ICE 123', 'Anzeigename aus trips[0]');
  assert.strictEqual(t.category, 'fern', 'Kategorie fern');
  assert.strictEqual(t.delayMin, 3, `delayMin: ${t.delayMin}`);
  assert.strictEqual(t.realTime, true, 'realTime übernommen');
  assert.strictEqual(t.polyline, polyDe, 'Polyline bleibt kodiert');
  assert.strictEqual(t.fromName, 'Wolfsburg Hbf');
  assert.strictEqual(t.toName, 'Hannover Hbf');

  // Grenzfilter: mit einem Quadrat-Ring weit weg (um [0, 0]) fliegt der Zug raus.
  const fernerRing: Ring[] = [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ];
  assert.strictEqual(normalizeTrips(fixture, nowMs, fernerRing).length, 0, 'Position außerhalb -> raus');
}

// --- e) LiveTripsService: Fake-fetch (Cache je Bucket, Fehlerpfad, DE-Bbox in der URL) ---
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
  assert.strictEqual(r1.error, null, `error muss null sein: ${r1.error}`);
  assert.strictEqual(r1.trains.length, 1, `Service: ${r1.trains.length} Züge statt 1`);
  assert.strictEqual(urls.length, 1, 'genau 1 Upstream-Call');

  // Burst-Cache: sofortiger zweiter Aufruf desselben Buckets -> KEIN weiterer Upstream-Call.
  const r2 = await svc.getTrains(6);
  assert.strictEqual(urls.length, 1, 'Cache-Treffer: weiterhin 1 Upstream-Call');
  assert.strictEqual(r2, r1, 'Cache liefert dasselbe Ergebnisobjekt');

  // Anderer Zoom-Bucket -> eigener Cache-Eintrag -> zweiter Upstream-Call.
  await svc.getTrains(9);
  assert.strictEqual(urls.length, 2, 'anderer Bucket: 2. Upstream-Call');

  // Zoom-Klemmung: 20 -> Bucket 14.
  await svc.getTrains(20);
  assert.strictEqual(urls.length, 3, 'geklemmter Bucket: 3. Upstream-Call');
  assert.strictEqual(new URL(urls[2]!).searchParams.get('zoom'), '14', 'zoom auf 14 geklemmt');

  // URL enthält die Deutschland-Bbox (min~47.2,5.8; max~55.1,15.1) + Bucket.
  const u = new URL(urls[0]!);
  assert.strictEqual(u.searchParams.get('zoom'), '6', 'zoom=6 in der URL');
  const min = (u.searchParams.get('min') ?? '').split(',').map(Number);
  const max = (u.searchParams.get('max') ?? '').split(',').map(Number);
  assert.strictEqual(min.length, 2, 'min=lat,lon');
  assert.strictEqual(max.length, 2, 'max=lat,lon');
  nahe(min[0]!, 47.2, 0.3, 'min lat (DE-Süd)');
  nahe(min[1]!, 5.8, 0.3, 'min lon (DE-West)');
  nahe(max[0]!, 55.1, 0.3, 'max lat (DE-Nord)');
  nahe(max[1]!, 15.1, 0.3, 'max lon (DE-Ost)');
  assert.ok(u.searchParams.get('startTime'), 'startTime gesetzt');
  assert.ok(u.searchParams.get('endTime'), 'endTime gesetzt');

  // Fehlerpfad: ttlMs=0 (Cache aus) + werfender fetch -> error gesetzt, trains leer, KEIN throw.
  const kaputt = (async () => {
    throw new Error('Netz weg');
  }) as unknown as typeof fetch;
  const svcFehler = new LiveTripsService({ ttlMs: 0, fetchFn: kaputt });
  const rf = await svcFehler.getTrains(6);
  assert.deepStrictEqual(rf.trains, [], 'Fehlerfall: keine Züge');
  assert.ok(rf.error && rf.error.includes('Netz weg'), `Fehlertext erwartet: ${rf.error}`);
}

console.log('live-trips selftest: OK');
