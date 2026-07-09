// Pure utility functions for Live-Züge decoding, track building, and position interpolation.
// Adheres to SOLID (Single Responsibility) and DRY principles.

export type Coord = [number, number]; // [lat, lon]

export interface Track {
  points: Coord[];
  cumDist: number[];
  total: number;
}

export interface TripSegment {
  mode: string;
  departure: string;
  arrival: string;
  scheduledDeparture: string;
  scheduledArrival: string;
  polyline: string;
  realTime?: boolean;
  from?: { name?: string };
  to?: { name?: string };
  trips?: { tripId?: string; displayName?: string }[];
}

export interface NormalizedTrip {
  id: string;
  name: string;
  mode: string;
  category: 'fern' | 'regio' | 'sbahn' | 'other';
  track: Track;
  departMs: number;
  arriveMs: number;
  schedDepartMs: number;
  schedArriveMs: number;
  delayMin: number;
  realTime: boolean;
  fromName: string;
  toName: string;
}

/**
 * Decodes a Google Encoded Polyline into [[lat, lon], ...].
 */
export function decodePolyline(str: string, precision = 5): Coord[] {
  let idx = 0, lat = 0, lon = 0;
  const out: Coord[] = [];
  const f = Math.pow(10, precision);
  while (idx < str.length) {
    let b, shift = 0, res = 0;
    do {
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);
    shift = 0; res = 0;
    do {
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (res & 1) ? ~(res >> 1) : (res >> 1);
    out.push([lat / f, lon / f]);
  }
  return out;
}

/** Approx distance between two [lat,lon] points. */
function segDist(a: Coord, b: Coord): number {
  const dLat = b[0] - a[0];
  const dLon = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Pre-calculates track cumulative distances for linear interpolation.
 */
export function buildTrack(coords: Coord[]): Track {
  const cumDist: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1]! + segDist(coords[i - 1]!, coords[i]!));
  }
  return { points: coords, cumDist, total: cumDist.length ? cumDist[cumDist.length - 1]! : 0 };
}

/**
 * Finds the position at fraction `frac` (0..1) of the track length.
 */
export function positionAt(track: Track, frac: number): Coord | null {
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
  const segLen = (cd[i]! - segStart) || 1;
  const t = (target - segStart) / segLen;
  const a = pts[i - 1]!, b = pts[i]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export const RAIL_MODES = new Set([
  'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL',
  'REGIONAL_RAIL', 'REGIONAL_FAST_RAIL', 'SUBURBAN',
]);

export function isRailMode(mode: string): boolean {
  return RAIL_MODES.has(mode);
}

export function categoryOf(mode: string): 'fern' | 'regio' | 'sbahn' | 'other' {
  if (mode === 'HIGHSPEED_RAIL' || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL') return 'fern';
  if (mode === 'REGIONAL_RAIL' || mode === 'REGIONAL_FAST_RAIL') return 'regio';
  if (mode === 'SUBURBAN') return 'sbahn';
  return 'other';
}

export const CATEGORY_COLOR = {
  fern: '#ef4444', // Red
  regio: '#10b981', // Green
  sbahn: '#3b82f6', // Blue
  other: '#9ca3af', // Grey
};

/** Ray-casting algorithm: checks if [lon, lat] is inside a single ring polygon. */
export function pointInRing(lon: number, lat: number, ring: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![1], yi = ring[i]![0]; // ring coordinates are typically [lat, lon]
    const xj = ring[j]![1], yj = ring[j]![0];
    if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Checks if [lon, lat] is inside any of the boundary rings. */
export function pointInBoundary(lon: number, lat: number, rings: Coord[][] | null): boolean {
  if (!rings || !rings.length) return true;
  for (const ring of rings) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

/** Extracts outer rings from a (Multi)Polygon GeoJSON. */
export function boundaryRings(geojson: any): Coord[][] {
  const rings: Coord[][] = [];
  const feats = geojson && geojson.type === 'FeatureCollection'
    ? geojson.features
    : [geojson && geojson.type === 'Feature' ? geojson : { geometry: geojson }];
  for (const f of feats) {
    const g = (f && f.geometry) || f;
    if (!g) continue;
    if (g.type === 'Polygon') {
      rings.push(g.coordinates[0]);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        rings.push(poly[0]);
      }
    }
  }
  return rings;
}

/**
 * Normalizes raw Transitous trips array to trips suitable for map rendering.
 * Optionally filters by German boundary rings.
 */
export function normalizeTrips(
  rawArray: TripSegment[], 
  nowMs: number, 
  rings: Coord[][] | null = null
): NormalizedTrip[] {
  const out: NormalizedTrip[] = [];
  if (!Array.isArray(rawArray)) return out;
  for (const seg of rawArray) {
    if (!seg || !isRailMode(seg.mode)) continue;
    const departMs = Date.parse(seg.departure);
    const arriveMs = Date.parse(seg.arrival);
    if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs <= departMs) continue;
    if (typeof seg.polyline !== 'string' || seg.polyline.length === 0) continue;
    
    const coords = decodePolyline(seg.polyline);
    if (coords.length < 2) continue;
    const track = buildTrack(coords);

    // If boundary filter is active, check if current train position is inside Germany.
    if (rings && rings.length) {
      const span = arriveMs - departMs;
      const frac = span > 0 ? (nowMs - departMs) / span : 0;
      const pos = positionAt(track, frac);
      if (!pos || !pointInBoundary(pos[1], pos[0], rings)) continue;
    }

    const trip = (Array.isArray(seg.trips) && seg.trips[0]) ? seg.trips[0] : {};
    const schedDepartMs = Date.parse(seg.scheduledDeparture);
    const schedArriveMs = Date.parse(seg.scheduledArrival);
    const delayMin = Number.isFinite(schedDepartMs) ? Math.round((departMs - schedDepartMs) / 60000) : 0;

    out.push({
      id: `${trip.tripId || seg.mode}@${departMs}`,
      name: trip.displayName || '',
      mode: seg.mode,
      category: categoryOf(seg.mode),
      track,
      departMs,
      arriveMs,
      schedDepartMs: Number.isFinite(schedDepartMs) ? schedDepartMs : departMs,
      schedArriveMs: Number.isFinite(schedArriveMs) ? schedArriveMs : arriveMs,
      delayMin,
      realTime: seg.realTime === true,
      fromName: (seg.from && seg.from.name) || '',
      toName: (seg.to && seg.to.name) || '',
    });
  }
  return out;
}

