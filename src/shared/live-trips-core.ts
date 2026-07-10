// Pure core logic for live trains: mode filter, categories, and normalization of
// Transitous map/trips segments into slim TrainDTOs (the server is authoritative;
// the client only ever receives these DTOs via /api/livetrips).
import { decodePolyline } from './polyline.js';
import { buildTrack, pointInBoundary, positionAt, type Ring } from './geo.js';

/** Railway modes (everything else – bus, subway, tram, ferry – is discarded). */
export const RAIL_MODES = new Set([
  'HIGHSPEED_RAIL',
  'LONG_DISTANCE',
  'NIGHT_RAIL',
  'REGIONAL_RAIL',
  'REGIONAL_FAST_RAIL',
  'SUBURBAN',
]);

export function isRailMode(mode: unknown): boolean {
  return typeof mode === 'string' && RAIL_MODES.has(mode);
}

export type TrainCategory = 'long-distance' | 'regional' | 'suburban' | 'other';

/** Coarse category used for color selection. */
export function categoryOf(mode: string): TrainCategory {
  if (mode === 'HIGHSPEED_RAIL' || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL') return 'long-distance';
  if (mode === 'REGIONAL_RAIL' || mode === 'REGIONAL_FAST_RAIL') return 'regional';
  if (mode === 'SUBURBAN') return 'suburban';
  return 'other';
}

/** Category colors, distinct from the infrastructure overlays. */
export const CATEGORY_COLOR: Record<Exclude<TrainCategory, 'other'>, string> = {
  'long-distance': '#d23f3f',
  regional: '#2ec76b',
  suburban: '#2f7fe0',
};

/** Fallback color for unknown categories. */
export const CATEGORY_COLOR_FALLBACK = '#8894a0';

/** Slim train object delivered to the client (polyline stays encoded). */
export interface TrainDTO {
  id: string;
  name: string;
  mode: string;
  category: TrainCategory;
  polyline: string;
  departMs: number;
  arriveMs: number;
  schedDepartMs: number;
  schedArriveMs: number;
  delayMin: number;
  realTime: boolean;
  fromName: string;
  toName: string;
}

/** Narrow view of a raw map/trips segment (only the fields we use). */
interface RawSegment {
  mode?: string;
  departure?: string;
  arrival?: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  realTime?: boolean;
  polyline?: string;
  from?: { name?: string };
  to?: { name?: string };
  trips?: { tripId?: string; displayName?: string }[];
}

/**
 * Converts raw map/trips segments into TrainDTOs.
 * Discards non-railway modes, invalid times, and undecodable polylines.
 * @param rawArray raw response from map/trips
 * @param nowMs current time (ms) – determines the train position for the boundary filter
 * @param rings optional national boundary (outer rings); when set, only trains
 *        whose CURRENT position lies inside the boundary are kept.
 */
export function normalizeTrips(rawArray: unknown, nowMs: number, rings: Ring[] | null = null): TrainDTO[] {
  const out: TrainDTO[] = [];
  if (!Array.isArray(rawArray)) return out;
  for (const raw of rawArray as RawSegment[]) {
    if (!raw || !isRailMode(raw.mode)) continue;
    const departMs = Date.parse(raw.departure ?? '');
    const arriveMs = Date.parse(raw.arrival ?? '');
    if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs <= departMs) continue;
    if (typeof raw.polyline !== 'string' || raw.polyline.length === 0) continue;
    const coords = decodePolyline(raw.polyline);
    if (coords.length < 2) continue;

    // Only trains whose CURRENT position lies inside the boundary (points are [lat, lon]).
    if (rings && rings.length) {
      const span = arriveMs - departMs;
      const frac = span > 0 ? (nowMs - departMs) / span : 0;
      const pos = positionAt(buildTrack(coords), frac);
      if (!pos || !pointInBoundary(pos[1], pos[0], rings)) continue;
    }

    const trip = (Array.isArray(raw.trips) && raw.trips[0]) || {};
    const schedDepartMs = Date.parse(raw.scheduledDeparture ?? '');
    const schedArriveMs = Date.parse(raw.scheduledArrival ?? '');
    const delayMin = Number.isFinite(schedDepartMs) ? Math.round((departMs - schedDepartMs) / 60000) : 0;

    out.push({
      id: `${trip.tripId || raw.mode}@${departMs}`,
      name: trip.displayName || '',
      mode: raw.mode!,
      category: categoryOf(raw.mode!),
      polyline: raw.polyline,
      departMs,
      arriveMs,
      schedDepartMs: Number.isFinite(schedDepartMs) ? schedDepartMs : departMs,
      schedArriveMs: Number.isFinite(schedArriveMs) ? schedArriveMs : arriveMs,
      delayMin,
      realTime: raw.realTime === true,
      fromName: raw.from?.name || '',
      toName: raw.to?.name || '',
    });
  }
  return out;
}
