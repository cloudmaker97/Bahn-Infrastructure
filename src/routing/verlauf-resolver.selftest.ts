// Selbsttest fuer den VerlaufResolver (+ Kantenfilter in Graph.dijkstra).
// Komplett OFFLINE: kleines Fake-Netz aus Graph + StationLookup-Stub.
// Laufbar mit: npx tsx src/routing/verlauf-resolver.selftest.ts
import assert from 'node:assert';
import { Graph } from '../core/graph.js';
import { VerlaufResolver, vereinfache } from './verlauf-resolver.js';
import type { LatLng, StationLookup } from '../types.js';

// --- Fake-Netz ---
// AA(1) --100--> BB(2) --100--> CC(3)   (Bogen ueber BB, je 15 km)
// AA(1) --------200-----------> CC(3)   (direkte Kante, 20 km -> "short"-Favorit)
// FF(6) --300--> HH(8) --300--> GG(7)   (einziger Weg = grosser Umweg, 2x100 km)
const graph = new Graph();
graph.addBidirectional(1, 2, {
  timeMin: 10, distKm: 15, strecke: 100,
  coords: [[50.0, 8.0], [50.05, 8.06], [50.1, 8.1]] as LatLng[],
});
// Mittelpunkt bewusst NICHT kollinear zu den Nachbarn, sonst raeumt die
// Douglas-Peucker-Vereinfachung den Stosspunkt (BB) weg.
graph.addBidirectional(2, 3, {
  timeMin: 10, distKm: 15, strecke: 100,
  coords: [[50.1, 8.1], [50.15, 8.11], [50.2, 8.2]] as LatLng[],
});
graph.addBidirectional(1, 3, {
  timeMin: 8, distKm: 20, strecke: 200,
  coords: [[50.0, 8.0], [50.2, 8.2]] as LatLng[],
});
graph.addBidirectional(6, 8, {
  timeMin: 60, distKm: 100, strecke: 300,
  coords: [[50.0, 8.0], [51.5, 9.5]] as LatLng[],
});
graph.addBidirectional(8, 7, {
  timeMin: 60, distKm: 100, strecke: 300,
  coords: [[51.5, 9.5], [50.05, 8.0]] as LatLng[],
});
// Kante mit ungerundeten Koordinaten fuer den Rundungs-Test.
graph.addBidirectional(20, 21, {
  timeMin: 1, distKm: 1, strecke: 400,
  coords: [[50.123456789, 8.987654321], [50.2, 9.0]] as LatLng[],
});

const stels = new Map<string, number>([
  ['AA', 1], ['BB', 2], ['CC', 3], ['FF', 6], ['GG', 7], ['HH', 8], ['RA', 20], ['RB', 21],
]);
const stations: StationLookup = {
  resolveStel: (code) => (code ? stels.get(code.trim()) ?? null : null),
  getStation: () => undefined,
};

// --- 1) Graph.dijkstra: Kantenfilter beschraenkt die Suche ---
{
  const frei = graph.dijkstra(1, 3, 'short');
  assert.ok(frei, 'unbeschraenkt: Pfad vorhanden');
  assert.strictEqual(frei!.edges.length, 1, 'unbeschraenkt: direkte Kante (20 km) gewinnt');
  assert.strictEqual(frei!.edges[0]!.strecke, 200);

  const nur100 = graph.dijkstra(1, 3, 'short', (e) => e.strecke === 100);
  assert.ok(nur100, 'Filter 100: Pfad vorhanden');
  assert.strictEqual(nur100!.edges.length, 2, 'Filter 100: Bogen ueber BB');
  assert.deepStrictEqual(nur100!.nodesSeq, [1, 2, 3]);

  const nur999 = graph.dijkstra(1, 3, 'short', (e) => e.strecke === 999);
  assert.strictEqual(nur999, null, 'Filter ohne passende Kanten -> null');
}

// --- 2) Resolver folgt der gemeldeten Strecke (Bogen statt Direktkante) ---
{
  const r = new VerlaufResolver(graph, stations);
  const kette = r.resolve('AA', 'CC', [100]);
  assert.ok(kette, 'Verlauf AA->CC auf Strecke 100 aufloesbar');
  // [lon,lat]-Kette beider Kanten, Stosspunkt (BB) nur einmal.
  assert.strictEqual(kette!.length, 5, 'Stosspunkt dedupliziert (5 statt 6 Punkte)');
  assert.deepStrictEqual(kette![0], [8.0, 50.0], 'GeoJSON-Reihenfolge [lon, lat]');
  assert.deepStrictEqual(kette![2], [8.1, 50.1], 'Zwischenpunkt BB');
  assert.deepStrictEqual(kette![4], [8.2, 50.2], 'Endpunkt CC');
}

// --- 3) Unbekannte Strecke -> unbeschraenkter Fallback (Direktkante) ---
{
  const r = new VerlaufResolver(graph, stations);
  const kette = r.resolve('AA', 'CC', [999]);
  assert.ok(kette, 'Fallback aufloesbar');
  assert.strictEqual(kette!.length, 2, 'Fallback nimmt die direkte Kante (Strecke 200)');
}

// --- 4) Umweg-Guard: 200 km Pfad bei ~5,6 km Luftlinie -> null ---
{
  const r = new VerlaufResolver(graph, stations);
  assert.strictEqual(r.resolve('FF', 'GG'), null, 'wilder Umweg wird verworfen');
  // Mit passender Streckennummer ist der Verlauf explizit gemeldet -> erlaubt.
  const explizit = r.resolve('FF', 'GG', [300]);
  assert.ok(explizit && explizit.length >= 3, 'explizit gemeldete Strecke gilt ohne Guard');
}

// --- 5) Unaufloesbares ---
{
  const r = new VerlaufResolver(graph, stations);
  assert.strictEqual(r.resolve('XX', 'CC'), null, 'unbekannter RIL100 -> null');
  assert.strictEqual(r.resolve('AA', 'AA'), null, 'von == bis -> null');
  assert.strictEqual(r.resolve('AA', 'FF'), null, 'unverbundene Teilnetze -> null');
}

// --- 5b) Bahnhofsteil-Fallback: "AA  X" (unbekannter Bft) -> Basis "AA" ---
{
  const r = new VerlaufResolver(graph, stations);
  const kette = r.resolve('AA  X', 'CC', [100]);
  assert.ok(kette && kette.length === 5, 'Bft-Code faellt auf Basis-Betriebsstelle zurueck');
  assert.strictEqual(r.resolve('AA  X', 'AA'), null, 'Bft und Basis identisch -> null');
}

// --- 6) Cache symmetrisch + leereCache ---
{
  const r = new VerlaufResolver(graph, stations);
  const hin = r.resolve('AA', 'CC', [100])!;
  const zurueck = r.resolve('CC', 'AA', [100])!;
  assert.deepStrictEqual(zurueck, [...hin].reverse(), 'Rueckrichtung = umgekehrte Kette');
  r.leereCache();
  assert.deepStrictEqual(r.resolve('AA', 'CC', [100]), hin, 'nach leereCache identisch');
}

// --- 7) Koordinaten auf 5 Nachkommastellen gerundet ---
{
  const r = new VerlaufResolver(graph, stations);
  const kette = r.resolve('RA', 'RB', [400])!;
  assert.deepStrictEqual(kette[0], [8.98765, 50.12346], 'Rundung auf ~1 m');
}

// --- 8) Douglas-Peucker-Vereinfachung ---
{
  // Mittelpunkt weicht nur ~0,7 m ab -> faellt bei 15 m Toleranz weg.
  const fastGerade: [number, number][] = [[8.0, 50.0], [8.00001, 50.05], [8.0, 50.1]];
  assert.deepStrictEqual(vereinfache(fastGerade, 15), [[8.0, 50.0], [8.0, 50.1]],
    'quasi-kollinearer Punkt entfernt');

  // Echte Ecke (km-Abweichung) bleibt erhalten.
  const ecke: [number, number][] = [[8.0, 50.0], [8.1, 50.0], [8.1, 50.1]];
  assert.deepStrictEqual(vereinfache(ecke, 15), ecke, 'Eckpunkt bleibt');

  // Endpunkte bleiben immer erhalten, 2-Punkt-Ketten unveraendert.
  assert.deepStrictEqual(vereinfache([[8.0, 50.0], [8.1, 50.1]], 15), [[8.0, 50.0], [8.1, 50.1]]);
}

console.log('SELFTEST OK');
