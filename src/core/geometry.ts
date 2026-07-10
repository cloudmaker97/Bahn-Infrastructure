// Pure geometry/parsing helpers (stateless, no class needed).
import type { LatLng } from '../types.js';

/** Parses a number that uses a German decimal comma. */
export function parseGermanNumber(v: unknown): number {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(',', '.'));
}

/** Haversine distance in km between two [lat,lon] points. */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const la1 = a[0] * toRad, la2 = b[0] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Total length of a polyline ([lat,lon]) in km. */
export function polylineLengthKm(coords: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversine(coords[i - 1]!, coords[i]!);
  return km;
}

/** Round to ~1 m (5 decimal places) – keeps serialized GeoJSON payloads small. */
export function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

// Two vertices count as identical (seam between two segments) when they are
// closer than this – the duplicated vertex at the seam is then dropped. 1 m is
// far below the real vertex spacing (~200 m), so nothing genuine gets merged.
const SEAM_KM = 0.001;

// Two segments count as parallel duplicate geometry when BOTH endpoints (in
// either orientation) are closer than this. 60 m captures the track spacing of
// parallel up/down tracks while staying far below the length of independent
// fragments (hundreds of meters+), so nothing genuine gets merged.
const DUPLICATE_KM = 0.06;

/** Are two points closer than `km` kilometers? */
function isNear(a: LatLng, b: LatLng, km: number): boolean {
  return haversine(a, b) < km;
}

/**
 * Stitches the segments of a MultiLineString geometry into ONE [lat,lon] chain
 * with as few gaps as possible. The ISR section geometries are nasty twice over:
 *  1. Their fragments come in ARBITRARY order AND orientation – naively
 *     concatenating them in file order produces large jumps.
 *  2. A section often contains BOTH parallel tracks (up/down track) as separate
 *     segments covering the same from->to path. Chaining them in would make the
 *     edge run out and back again (a loop).
 *
 * Therefore: first discard parallel duplicate segments (same endpoint pair),
 * then greedily stitch the rest – always attach the segment whose nearest end
 * is closest to the chain's head OR tail (reversed if needed). Real data gaps
 * (far-apart fragments) remain a jump; that is more honest than an artificial
 * zigzag.
 */
export function stitchSegments(pieces: LatLng[][]): LatLng[] {
  const raw = pieces.filter((t) => t.length > 0).map((t) => t.slice());
  if (raw.length === 0) return [];
  // Drop parallel duplicate geometry (keep only the first segment per endpoint pair).
  const remaining: LatLng[][] = [];
  for (const t of raw) {
    const a = t[0]!, b = t[t.length - 1]!;
    const isDuplicate = remaining.some((u) => {
      const ua = u[0]!, ub = u[u.length - 1]!;
      return (isNear(a, ua, DUPLICATE_KM) && isNear(b, ub, DUPLICATE_KM))
        || (isNear(a, ub, DUPLICATE_KM) && isNear(b, ua, DUPLICATE_KM));
    });
    if (!isDuplicate) remaining.push(t);
  }
  const chain: LatLng[] = remaining.shift()!;
  while (remaining.length > 0) {
    const head = chain[0]!;
    const tail = chain[chain.length - 1]!;
    let idx = -1, minDist = Infinity, appendAtTail = true, reverse = false;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]![0]!;
      const e = remaining[i]![remaining[i]!.length - 1]!;
      // Append at the chain's tail (the joining point should become part[0]).
      if (haversine(tail, s) < minDist) { minDist = haversine(tail, s); idx = i; appendAtTail = true; reverse = false; }
      if (haversine(tail, e) < minDist) { minDist = haversine(tail, e); idx = i; appendAtTail = true; reverse = true; }
      // Prepend before the chain's head (the joining point should become part[last]).
      if (haversine(head, e) < minDist) { minDist = haversine(head, e); idx = i; appendAtTail = false; reverse = false; }
      if (haversine(head, s) < minDist) { minDist = haversine(head, s); idx = i; appendAtTail = false; reverse = true; }
    }
    let piece = remaining.splice(idx, 1)[0]!;
    if (reverse) piece.reverse();
    if (appendAtTail) {
      if (haversine(chain[chain.length - 1]!, piece[0]!) < SEAM_KM) piece = piece.slice(1);
      chain.push(...piece);
    } else {
      if (haversine(chain[0]!, piece[piece.length - 1]!) < SEAM_KM) piece = piece.slice(0, -1);
      chain.unshift(...piece);
    }
  }
  return chain;
}

/** Parses 'ALG_GEO_LAGE' ('+9.13, 49.95') into { lat, lon } or null. */
export function parsePosition(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.replace(/\+/g, '').split(',').map((x) => parseFloat(x));
  if (parts.length === 2 && isFinite(parts[0]!) && isFinite(parts[1]!)) {
    return { lon: parts[0]!, lat: parts[1]! };
  }
  return null;
}
