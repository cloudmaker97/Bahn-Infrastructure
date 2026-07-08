// Selbsttest der reinen Live-Zug-Kernfunktionen (ohne Netz/Browser).
// Laufbar mit: npx tsx public/live-trips.selftest.mjs
import assert from 'node:assert';
import { decodePolyline, buildTrack, positionAt, isRailMode, categoryOf } from './live-trips.js';

// --- 1) decodePolyline (Standard-Google-Testvektor, Präzision 5) ---
{
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.strictEqual(pts.length, 3, 'drei Punkte erwartet');
  assert.ok(Math.abs(pts[0][0] - 38.5) < 1e-5 && Math.abs(pts[0][1] + 120.2) < 1e-5, 'Punkt 1');
  assert.ok(Math.abs(pts[1][0] - 40.7) < 1e-5 && Math.abs(pts[1][1] + 120.95) < 1e-5, 'Punkt 2');
  assert.ok(Math.abs(pts[2][0] - 43.252) < 1e-5 && Math.abs(pts[2][1] + 126.453) < 1e-5, 'Punkt 3');
}

// --- 2) buildTrack / positionAt ---
{
  const track = buildTrack([[0, 0], [0, 10]]);
  assert.ok(Math.abs(track.total - 10) < 1e-6, 'Gesamtlänge ~10');
  assert.deepStrictEqual(positionAt(track, 0), [0, 0], 'frac 0 -> Start');
  assert.deepStrictEqual(positionAt(track, 1), [0, 10], 'frac 1 -> Ende');
  const mid = positionAt(track, 0.5);
  assert.ok(Math.abs(mid[0]) < 1e-6 && Math.abs(mid[1] - 5) < 1e-6, 'frac 0.5 -> Mitte');
  assert.deepStrictEqual(positionAt(track, -1), [0, 0], 'Klemmung unten');
  assert.deepStrictEqual(positionAt(track, 2), [0, 10], 'Klemmung oben');

  const drei = buildTrack([[0, 0], [0, 10], [0, 20]]);
  assert.ok(Math.abs(positionAt(drei, 0.5)[1] - 10) < 1e-6, 'gleichmäßiger 3-Punkt-Track: Mitte bei 10');
}

// --- 3) isRailMode / categoryOf ---
{
  assert.ok(isRailMode('HIGHSPEED_RAIL'), 'ICE ist Bahn');
  assert.ok(isRailMode('REGIONAL_RAIL'), 'Regio ist Bahn');
  assert.ok(isRailMode('SUBURBAN'), 'S-Bahn ist Bahn');
  assert.ok(!isRailMode('BUS'), 'Bus ist keine Bahn');
  assert.ok(!isRailMode('SUBWAY'), 'U-Bahn ausgeschlossen');
  assert.ok(!isRailMode('FERRY'), 'Fähre ausgeschlossen');
  assert.strictEqual(categoryOf('HIGHSPEED_RAIL'), 'fern');
  assert.strictEqual(categoryOf('LONG_DISTANCE'), 'fern');
  assert.strictEqual(categoryOf('REGIONAL_RAIL'), 'regio');
  assert.strictEqual(categoryOf('SUBURBAN'), 'sbahn');
}

console.log('live-trips selftest: OK');
