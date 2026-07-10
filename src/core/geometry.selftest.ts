// Selftest for the pure geometry helpers (focus: stitchSegments).
// Run with: npx tsx src/core/geometry.selftest.ts
import assert from 'node:assert';
import { stitchSegments, polylineLengthKm } from './geometry.js';
import type { LatLng } from '../types.js';

/** Largest jump between two consecutive vertices (km). */
function maxSegKm(chain: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < chain.length; i++) {
    const d = polylineLengthKm([chain[i - 1]!, chain[i]!]);
    if (d > m) m = d;
  }
  return m;
}

// A smooth reference chain (vertices ~200 m apart along a meridian).
const N = 12;
const REF: LatLng[] = Array.from({ length: N }, (_, i) => [49.5 + i * 0.002, 11.4] as LatLng);

// --- 1) Already-chained input stays unchanged (apart from seam dedup) ---
{
  const pieces = [REF.slice(0, 5), REF.slice(4, 9), REF.slice(8)]; // already in order, seams overlap
  const chain = stitchSegments(pieces);
  assert.ok(maxSegKm(chain) < 0.3, `intact chain: maxSeg ${maxSegKm(chain)} km`);
  // The endpoints remain those of the full line.
  assert.deepStrictEqual(chain[0], REF[0]);
  assert.deepStrictEqual(chain[chain.length - 1], REF[N - 1]);
}

// --- 2) Shuffled AND reversed segments -> smooth chain (core of the fix) ---
{
  // Order shuffled and individual fragments reversed, as found in the ISR data.
  const a = REF.slice(0, 4);
  const b = REF.slice(3, 7).reverse();   // reversed
  const c = REF.slice(6, 10);
  const d = REF.slice(9).reverse();      // reversed
  const shuffled = [c, a, d, b];         // file order is arbitrary

  const naive: LatLng[] = [];
  for (const t of shuffled) naive.push(...t);
  assert.ok(maxSegKm(naive) > 0.5, `naive concatenation jumps: maxSeg ${maxSegKm(naive)} km`);

  const chain = stitchSegments(shuffled);
  assert.ok(maxSegKm(chain) < 0.3, `stitched smoothly: maxSeg ${maxSegKm(chain)} km`);
  // The chain covers all points and runs monotonically (total length ~ reference).
  const refLen = polylineLengthKm(REF);
  assert.ok(Math.abs(polylineLengthKm(chain) - refLen) < 0.05,
    `length ~ reference: ${polylineLengthKm(chain)} vs ${refLen}`);
}

// --- 3) Parallel duplicate geometry (up/down track) -> NO loop ---
{
  // Two nearly congruent segments (~10 m apart), both from->to.
  // Without dedup the second one would be appended backwards -> the chain runs
  // out and back (end ~ start). With dedup a clean from->to line remains.
  const trackA = REF.map(([la, lo]) => [la, lo] as LatLng);
  const trackB = REF.map(([la, lo]) => [la, lo + 0.0001] as LatLng); // ~7 m parallel offset
  const chain = stitchSegments([trackA, trackB]);
  const endToEnd = polylineLengthKm([chain[0]!, chain[chain.length - 1]!]);
  const refLen = polylineLengthKm(REF);
  assert.ok(endToEnd > refLen * 0.9,
    `no loop: endpoint distance ${endToEnd.toFixed(2)} ~ line length ${refLen.toFixed(2)}`);
  assert.ok(polylineLengthKm(chain) < refLen * 1.2,
    `length not doubled: ${polylineLengthKm(chain).toFixed(2)} km`);
}

// --- 4) Edge cases ---
{
  assert.deepStrictEqual(stitchSegments([]), []);
  assert.deepStrictEqual(stitchSegments([[]]), []);
  const single = REF.slice(0, 3);
  assert.deepStrictEqual(stitchSegments([single]), single, 'single segment unchanged');
}

console.log('SELFTEST OK');
