// Selftest for the AlignmentResolver (+ edge filter in Graph.dijkstra).
// Completely OFFLINE: small fake network built from Graph + a StationLookup stub.
// Run with: npx tsx src/routing/alignment-resolver.selftest.ts
import assert from 'node:assert';
import { Graph } from '../core/graph.js';
import { AlignmentResolver, simplifyPath } from './alignment-resolver.js';
import type { LatLng, StationLookup } from '../types.js';

// --- Fake network ---
// AA(1) --100--> BB(2) --100--> CC(3)   (arc via BB, 15 km each)
// AA(1) --------200-----------> CC(3)   (direct edge, 20 km -> "short" favorite)
// FF(6) --300--> HH(8) --300--> GG(7)   (only path = huge detour, 2x100 km)
const graph = new Graph();
graph.addBidirectional(1, 2, {
  timeMin: 10, distKm: 15, lineNumber: 100,
  coords: [[50.0, 8.0], [50.05, 8.06], [50.1, 8.1]] as LatLng[],
});
// The middle point is deliberately NOT collinear with its neighbors, otherwise
// the Douglas-Peucker simplification would remove the seam point (BB).
graph.addBidirectional(2, 3, {
  timeMin: 10, distKm: 15, lineNumber: 100,
  coords: [[50.1, 8.1], [50.15, 8.11], [50.2, 8.2]] as LatLng[],
});
graph.addBidirectional(1, 3, {
  timeMin: 8, distKm: 20, lineNumber: 200,
  coords: [[50.0, 8.0], [50.2, 8.2]] as LatLng[],
});
graph.addBidirectional(6, 8, {
  timeMin: 60, distKm: 100, lineNumber: 300,
  coords: [[50.0, 8.0], [51.5, 9.5]] as LatLng[],
});
graph.addBidirectional(8, 7, {
  timeMin: 60, distKm: 100, lineNumber: 300,
  coords: [[51.5, 9.5], [50.05, 8.0]] as LatLng[],
});
// Edge with unrounded coordinates for the rounding test.
graph.addBidirectional(20, 21, {
  timeMin: 1, distKm: 1, lineNumber: 400,
  coords: [[50.123456789, 8.987654321], [50.2, 9.0]] as LatLng[],
});

const stels = new Map<string, number>([
  ['AA', 1], ['BB', 2], ['CC', 3], ['FF', 6], ['GG', 7], ['HH', 8], ['RA', 20], ['RB', 21],
]);
const stations: StationLookup = {
  resolveStel: (code) => (code ? stels.get(code.trim()) ?? null : null),
  getStation: () => undefined,
};

// --- 1) Graph.dijkstra: the edge filter restricts the search ---
{
  const free = graph.dijkstra(1, 3, 'short');
  assert.ok(free, 'unrestricted: path exists');
  assert.strictEqual(free!.edges.length, 1, 'unrestricted: direct edge (20 km) wins');
  assert.strictEqual(free!.edges[0]!.lineNumber, 200);

  const only100 = graph.dijkstra(1, 3, 'short', (e) => e.lineNumber === 100);
  assert.ok(only100, 'filter 100: path exists');
  assert.strictEqual(only100!.edges.length, 2, 'filter 100: arc via BB');
  assert.deepStrictEqual(only100!.nodesSeq, [1, 2, 3]);

  const only999 = graph.dijkstra(1, 3, 'short', (e) => e.lineNumber === 999);
  assert.strictEqual(only999, null, 'filter without matching edges -> null');
}

// --- 2) Resolver follows the reported line (arc instead of direct edge) ---
{
  const r = new AlignmentResolver(graph, stations);
  const chain = r.resolve('AA', 'CC', [100]);
  assert.ok(chain, 'alignment AA->CC on line 100 resolvable');
  // [lon,lat] chain of both edges, seam point (BB) only once.
  assert.strictEqual(chain!.length, 5, 'seam point deduplicated (5 instead of 6 points)');
  assert.deepStrictEqual(chain![0], [8.0, 50.0], 'GeoJSON order [lon, lat]');
  assert.deepStrictEqual(chain![2], [8.1, 50.1], 'intermediate point BB');
  assert.deepStrictEqual(chain![4], [8.2, 50.2], 'endpoint CC');
}

// --- 3) Unknown line -> unrestricted fallback (direct edge) ---
{
  const r = new AlignmentResolver(graph, stations);
  const chain = r.resolve('AA', 'CC', [999]);
  assert.ok(chain, 'fallback resolvable');
  assert.strictEqual(chain!.length, 2, 'fallback takes the direct edge (line 200)');
}

// --- 4) Detour guard: 200 km path at ~5.6 km straight line -> null ---
{
  const r = new AlignmentResolver(graph, stations);
  assert.strictEqual(r.resolve('FF', 'GG'), null, 'wild detour is rejected');
  // With a matching line number the alignment is explicitly reported -> allowed.
  const explicit = r.resolve('FF', 'GG', [300]);
  assert.ok(explicit && explicit.length >= 3, 'explicitly reported line passes without guard');
}

// --- 5) Unresolvable cases ---
{
  const r = new AlignmentResolver(graph, stations);
  assert.strictEqual(r.resolve('XX', 'CC'), null, 'unknown RIL100 -> null');
  assert.strictEqual(r.resolve('AA', 'AA'), null, 'from == to -> null');
  assert.strictEqual(r.resolve('AA', 'FF'), null, 'disconnected sub-networks -> null');
}

// --- 5b) Station-part fallback: "AA  X" (unknown sub-station) -> base "AA" ---
{
  const r = new AlignmentResolver(graph, stations);
  const chain = r.resolve('AA  X', 'CC', [100]);
  assert.ok(chain && chain.length === 5, 'sub-station code falls back to base operating point');
  assert.strictEqual(r.resolve('AA  X', 'AA'), null, 'sub-station and base identical -> null');
}

// --- 6) Cache is symmetric + clearCache ---
{
  const r = new AlignmentResolver(graph, stations);
  const forward = r.resolve('AA', 'CC', [100])!;
  const backward = r.resolve('CC', 'AA', [100])!;
  assert.deepStrictEqual(backward, [...forward].reverse(), 'reverse direction = reversed chain');
  r.clearCache();
  assert.deepStrictEqual(r.resolve('AA', 'CC', [100]), forward, 'identical after clearCache');
}

// --- 7) Coordinates rounded to 5 decimal places ---
{
  const r = new AlignmentResolver(graph, stations);
  const chain = r.resolve('RA', 'RB', [400])!;
  assert.deepStrictEqual(chain[0], [8.98765, 50.12346], 'rounded to ~1 m');
}

// --- 8) Douglas-Peucker simplification ---
{
  // The middle point deviates only ~0.7 m -> removed at 15 m tolerance.
  const almostStraight: [number, number][] = [[8.0, 50.0], [8.00001, 50.05], [8.0, 50.1]];
  assert.deepStrictEqual(simplifyPath(almostStraight, 15), [[8.0, 50.0], [8.0, 50.1]],
    'quasi-collinear point removed');

  // A real corner (km deviation) is preserved.
  const corner: [number, number][] = [[8.0, 50.0], [8.1, 50.0], [8.1, 50.1]];
  assert.deepStrictEqual(simplifyPath(corner, 15), corner, 'corner point stays');

  // Endpoints are always preserved, 2-point chains unchanged.
  assert.deepStrictEqual(simplifyPath([[8.0, 50.0], [8.1, 50.1]], 15), [[8.0, 50.0], [8.1, 50.1]]);
}

console.log('SELFTEST OK');
