// Reine Kernlogik der Live-Züge: Modus-Filter, Kategorien und Normalisierung der
// Transitous-map/trips-Segmente zu schlanken TrainDTOs (Server ist federführend;
// der Client erhält nur noch diese DTOs über /api/livetrips).
import { decodePolyline } from './polyline.js';
import { buildTrack, pointInBoundary, positionAt, type Ring } from './geo.js';

/** Eisenbahn-Modi (alles andere – Bus, U-Bahn, Tram, Fähre – wird verworfen). */
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

export type TrainCategory = 'fern' | 'regio' | 'sbahn' | 'other';

/** Grobkategorie für die Farbwahl. */
export function categoryOf(mode: string): TrainCategory {
  if (mode === 'HIGHSPEED_RAIL' || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL') return 'fern';
  if (mode === 'REGIONAL_RAIL' || mode === 'REGIONAL_FAST_RAIL') return 'regio';
  if (mode === 'SUBURBAN') return 'sbahn';
  return 'other';
}

/** Kategorie-Farben, abgesetzt von den Infrastruktur-Overlays. */
export const CATEGORY_COLOR: Record<Exclude<TrainCategory, 'other'>, string> = {
  fern: '#d23f3f',
  regio: '#2ec76b',
  sbahn: '#2f7fe0',
};

/** Fallback-Farbe für unbekannte Kategorien. */
export const CATEGORY_COLOR_FALLBACK = '#8894a0';

/** Schlankes, an den Client ausgeliefertes Zug-Objekt (Polyline bleibt kodiert). */
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

/** Schmale Sicht auf ein rohes map/trips-Segment (nur benutzte Felder). */
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
 * Wandelt die Roh-Segmente von map/trips in TrainDTOs.
 * Verwirft Nicht-Eisenbahn, ungültige Zeiten und undekodierbare Polylinien.
 * @param rawArray Roh-Antwort von map/trips
 * @param nowMs aktueller Zeitpunkt (ms) – bestimmt die Zugposition für den Grenzfilter
 * @param rings optionale Landesgrenze (äußere Ringe); wenn gesetzt, werden nur Züge
 *        behalten, deren AKTUELLE Position innerhalb der Grenze liegt.
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

    // Nur Züge, deren AKTUELLE Position innerhalb der Grenze liegt (Punkte sind [lat, lon]).
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
