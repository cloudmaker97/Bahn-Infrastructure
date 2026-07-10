// Resolves the real track alignment between two operating points (RIL100) so
// that notices (disruptions/construction sites) follow the track instead of the
// straight line. Responsibility: alignment resolution (SRP). Depends only on
// abstractions (Pathfinder, StationLookup) -> DIP, testable without network/data.
import { haversine, round5 } from '../core/geometry.js';
import type { AlignmentLookup, Edge, Pathfinder, StationLookup } from '../types.js';

// Detour guard for the unrestricted search: when the shortest path runs around
// by more than max(3 x straight line, straight line + 30 km) (graph gap), the
// straight line is the more honest representation than a wild detour.
const DETOUR_FACTOR = 3;
const DETOUR_BONUS_KM = 30;

// Size cap for the memo cache: in headless operation there is no reload path
// that clears it; realistically there are a few thousand pairs, the cap is only
// the safety net against unbounded growth.
const CACHE_MAX = 5000;

/** Squared planar distance of two [lon,lat] points (comparisons only). */
function dist2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// Simplification tolerance: notice overlays (4-6 px wide lines) do not need
// track precision; 15 m is invisible at all zoom levels but shrinks the
// /api/streckeninfo payload considerably (polled every 3 min).
const SIMPLIFY_TOLERANCE_M = 15;
const METERS_PER_DEGREE = 111_320;

/**
 * Douglas-Peucker on a [lon,lat] chain; tolerance in meters (equirectangular
 * approximation, entirely sufficient for Germany). Endpoints are preserved.
 */
export function simplifyPath(chain: [number, number][], toleranceM: number): [number, number][] {
  if (chain.length <= 2) return chain;
  const kx = METERS_PER_DEGREE * Math.cos((chain[0]![1] * Math.PI) / 180);
  const ky = METERS_PER_DEGREE;
  const keep = new Array<boolean>(chain.length).fill(false);
  keep[0] = keep[chain.length - 1] = true;
  const stack: [number, number][] = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = chain[a]![0] * kx, ay = chain[a]![1] * ky;
    const bx = chain[b]![0] * kx, by = chain[b]![1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxDist = -1, maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = chain[i]![0] * kx - ax, py = chain[i]![1] * ky - ay;
      // Point->segment distance (t clamped to [0,1]; len2==0 -> distance to point a).
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx, ey = py - t * dy;
      const dist = Math.hypot(ex, ey);
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxIdx >= 0 && maxDist > toleranceM) {
      keep[maxIdx] = true;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  return chain.filter((_, i) => keep[i]);
}

export class AlignmentResolver {
  /** Memo per operating-point pair + lines; symmetric: (B,A) = reverse of (A,B). */
  private cache = new Map<string, [number, number][] | null>();

  constructor(private pathfinder: Pathfinder, private stations: StationLookup) {}

  /** Call after a data reload: graph/geometries may have changed. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Signature of AlignmentLookup (types.ts); a bound method property for easy DI. */
  resolve: AlignmentLookup = (fromRil100, toRil100, lineNumbers) => {
    const from = this.stelIdOf(fromRil100);
    const to = this.stelIdOf(toRil100);
    if (from == null || to == null || from === to) return null;

    const lines = [...new Set(lineNumbers ?? [])].sort((a, b) => a - b);
    const forward = from <= to;
    const key = `${Math.min(from, to)}|${Math.max(from, to)}|${lines.join(',')}`;
    let chain = this.cache.get(key);
    if (chain === undefined) {
      chain = this.compute(forward ? from : to, forward ? to : from, lines);
      if (this.cache.size >= CACHE_MAX) this.cache.clear();
      this.cache.set(key, chain);
    }
    if (chain === null) return null;
    return forward ? chain : [...chain].reverse();
  };

  /**
   * RIL100 to stel. Station-part codes (whitespace suffix, e.g. "TU  P" for a
   * sub-station of Ulm Hbf) are missing from the ISR station list; they fall
   * back to the base operating point ("TU") – a slightly offset endpoint, but a
   * real alignment instead of a straight line.
   */
  private stelIdOf(ril100: string): number | null {
    const code = ril100.trim();
    const direct = this.stations.resolveStel(code);
    if (direct != null) return direct;
    const base = code.split(/\s+/)[0];
    return base && base !== code ? this.stations.resolveStel(base) : null;
  }

  /**
   * Search order: a) restricted to the reported line numbers (follows the line
   * actually affected, expands only its nodes); b) unrestricted like the route
   * search, but with the detour guard; c) null (-> straight-line fallback).
   */
  private compute(start: number, goal: number, lines: number[]): [number, number][] | null {
    if (lines.length > 0) {
      const set = new Set(lines);
      const path = this.pathfinder.dijkstra(start, goal, 'short',
        (e) => e.lineNumber != null && set.has(e.lineNumber));
      const chain = path ? AlignmentResolver.chainEdgeGeometries(path.edges) : [];
      if (chain.length >= 2) return simplifyPath(chain, SIMPLIFY_TOLERANCE_M);
    }

    const path = this.pathfinder.dijkstra(start, goal, 'short');
    if (!path) return null;
    const chain = AlignmentResolver.chainEdgeGeometries(path.edges);
    if (chain.length < 2) return null;
    const distKm = path.edges.reduce((s, e) => s + e.distKm, 0);
    const [aLon, aLat] = chain[0]!;
    const [bLon, bLat] = chain[chain.length - 1]!;
    const straightKm = haversine([aLat, aLon], [bLat, bLon]);
    if (distKm > Math.max(straightKm * DETOUR_FACTOR, straightKm + DETOUR_BONUS_KM)) return null;
    return simplifyPath(chain, SIMPLIFY_TOLERANCE_M);
  }

  /**
   * Joins edge geometries ([lat,lon]) into one continuous [lon,lat] chain.
   * After the segment stitching in GraphBuilder, a stored edge geometry may run
   * in either OVERALL direction; each edge is therefore oriented so that its
   * start connects to the current chain end – otherwise the line would jump
   * back and forth between edges. Seams are deduplicated.
   */
  private static chainEdgeGeometries(edges: Edge[]): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < edges.length; i++) {
      const seg = edges[i]!.coords.map(([lat, lon]) => [round5(lon), round5(lat)] as [number, number]);
      if (seg.length === 0) continue;
      if (out.length === 0) {
        // Orient the first edge against the next one so that its end connects there.
        const next = edges[i + 1]?.coords;
        if (next && next.length > 0) {
          const n0: [number, number] = [round5(next[0]![1]), round5(next[0]![0])];
          const nEndRaw = next[next.length - 1]!;
          const nEnd: [number, number] = [round5(nEndRaw[1]), round5(nEndRaw[0])];
          const endNear = Math.min(dist2(seg[seg.length - 1]!, n0), dist2(seg[seg.length - 1]!, nEnd));
          const startNear = Math.min(dist2(seg[0]!, n0), dist2(seg[0]!, nEnd));
          if (startNear < endNear) seg.reverse();
        }
      } else {
        const end = out[out.length - 1]!;
        if (dist2(end, seg[seg.length - 1]!) < dist2(end, seg[0]!)) seg.reverse();
      }
      for (const p of seg) {
        const last = out[out.length - 1];
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        out.push(p);
      }
    }
    return out;
  }
}
