// Pure geo helpers: track interpolation and point-in-polygon against the national
// boundary. Shared by the server (DE filter in LiveTripsService) and the web
// frontend (train animation).
import type { LatLon } from './polyline.js';

/** A boundary ring as a [lon, lat] point list (GeoJSON order). */
export type Ring = [number, number][];

/** Precomputed travel path: points + cumulative distances for interpolation. */
export interface Track {
  points: LatLon[];
  cumDist: number[];
  total: number;
}

/** Approximate distance of two [lat,lon] points (equirectangular, parametrization only). */
function segDist(a: LatLon, b: LatLon): number {
  const dLat = b[0] - a[0];
  const dLon = (b[1] - a[1]) * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** Builds the cumulative distances for interpolation from a point list. */
export function buildTrack(coords: LatLon[]): Track {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1]! + segDist(coords[i - 1]!, coords[i]!));
  }
  return { points: coords, cumDist, total: cumDist.length ? cumDist[cumDist.length - 1]! : 0 };
}

/**
 * Position at fraction `frac` (0..1) of the total length; linear between vertices.
 * Clamps `frac` to [0, 1]. Returns null for an empty track.
 */
export function positionAt(track: Track, frac: number): LatLon | null {
  const pts = track.points;
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) return pts[0]!;
  const f = frac <= 0 ? 0 : frac >= 1 ? 1 : frac;
  const target = f * track.total;
  const cd = track.cumDist;
  let i = 1;
  while (i < cd.length && cd[i]! < target) i++;
  if (i >= cd.length) return pts[pts.length - 1]!;
  const segStart = cd[i - 1]!;
  const segLen = cd[i]! - segStart || 1;
  const t = (target - segStart) / segLen;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Ray casting: does [lon, lat] lie inside a ring? */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Does [lon, lat] lie in any of the (outer) rings? Without rings: true (no filter). */
export function pointInBoundary(lon: number, lat: number, rings: Ring[] | null | undefined): boolean {
  if (!rings || !rings.length) return true;
  for (const ring of rings) if (pointInRing(lon, lat, ring)) return true;
  return false;
}

/** Minimal GeoJSON view for ring extraction. */
interface GeoJsonLike {
  type?: string;
  features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  geometry?: { type?: string; coordinates?: unknown };
  coordinates?: unknown;
}

/** Extracts the outer rings from a (Multi)Polygon GeoJSON. */
export function boundaryRings(geojson: GeoJsonLike | null | undefined): Ring[] {
  const rings: Ring[] = [];
  const feats =
    geojson && geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)
      ? geojson.features
      : [geojson && geojson.type === 'Feature' ? geojson : { geometry: geojson as GeoJsonLike['geometry'] }];
  for (const f of feats) {
    const g = (f && (f as GeoJsonLike).geometry) || (f as GeoJsonLike['geometry']);
    if (!g || !g.coordinates) continue;
    if (g.type === 'Polygon') rings.push((g.coordinates as Ring[])[0]!);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates as Ring[][]) rings.push(poly[0]!);
  }
  return rings;
}

/** Enclosing bounding box of all ring points ([lon,lat]). */
export function ringsBbox(rings: Ring[]): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings || []) {
    for (const p of ring) {
      if (p[0] < minLon) minLon = p[0];
      if (p[0] > maxLon) maxLon = p[0];
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}
