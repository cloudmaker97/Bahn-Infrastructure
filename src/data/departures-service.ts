// Fetches the next departures at a station/operating point from the Transitous
// stoptimes API (resolved spatially via center+radius, so ISR coordinates work
// without a stop-id mapping) and returns a slim DeparturesResult for
// /api/departures. Responsibility: upstream fetch + short TTL cache per
// coordinate (SRP). The normalization is a pure exported function and fetch is
// injectable (DIP), so the service is testable without network access
// (pattern as in LiveTripsService/TripDetailsService).
import { DEPARTURES_API, DEPARTURES_TTL_MS } from '../config.js';
import { SingleFlight, TtlCache } from '../core/ttl-cache.js';
import { categoryOf, isRailMode, RAIL_MODES } from '../shared/live-trips-core.js';
import type { DepartureDTO, DeparturesResult } from '../shared/api-types.js';

export type { DeparturesResult } from '../shared/api-types.js';

/** Upstream timeout: a hanging Transitous must not block /api/departures. */
const FETCH_TIMEOUT_MS = 12_000;

/** Departures requested upstream (n = minimum number of events; deduping shrinks the list). */
const N_DEPARTURES = 20;

/** Cap against degenerate upstream data. */
const MAX_DEPARTURES = 30;

/**
 * Spatial stop resolution around the ISR coordinate. ISR operating-point
 * coordinates do not coincide exactly with the GTFS stop positions; 500 m with
 * exactRadius=false (default) also picks up stops MOTIS considers equivalent.
 */
const STOP_RADIUS_M = 500;

/** Narrow view of a raw stoptimes place (only the fields we use). */
interface RawStopTimePlace {
  name?: string;
  departure?: string;
  scheduledDeparture?: string;
  track?: string;
  scheduledTrack?: string;
}

/** Narrow view of a raw StopTime event (only the fields we use). */
interface RawStopTime {
  place?: RawStopTimePlace;
  mode?: string;
  realTime?: boolean;
  headsign?: string;
  displayName?: string;
  routeShortName?: string;
  tripId?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
}

function toMs(iso: string | undefined): number | null {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Dedup key of a physical departure. The same train can appear once per
 * upstream feed (e.g. "RB31 (81647)" realtime-only next to "RB31" with the
 * track from the static schedule) – scheduled time + destination + base train
 * name (parenthesized feed suffixes and spacing stripped) identify the event.
 */
function dedupKey(d: DepartureDTO): string {
  const base = d.name.replace(/\s*\(.*\)\s*$/, '').replace(/\s+/g, '').toUpperCase();
  return `${d.schedDepartMs}|${base}|${d.headsign}`;
}

/** Merges a duplicate feed entry into the kept one (realtime + track survive). */
function mergeDuplicate(into: DepartureDTO, dup: DepartureDTO): void {
  if (dup.realTime && !into.realTime) {
    into.realTime = true;
    into.departMs = dup.departMs;
    into.delayMin = dup.delayMin;
  }
  into.track = into.track ?? dup.track;
  into.scheduledTrack = into.scheduledTrack ?? dup.scheduledTrack;
  into.cancelled = into.cancelled || dup.cancelled;
  into.tripId = into.tripId || dup.tripId;
  // The variant without a feed suffix reads cleaner ("RB31" vs "RB31 (81647)").
  if (dup.name && dup.name.length < into.name.length) into.name = dup.name;
}

/**
 * Converts a raw stoptimes response into the slim departure list sorted by
 * (realtime) departure. Discards non-railway modes and events without any
 * departure time, merges per-feed duplicates. Returns null when the response
 * has no stopTimes array (an empty list is a valid result: no upcoming
 * departures).
 */
export function normalizeDepartures(raw: unknown): Omit<DeparturesResult, 'generatedAt' | 'error'> | null {
  const obj = raw as { stopTimes?: RawStopTime[]; place?: { name?: string } } | null;
  if (!obj || !Array.isArray(obj.stopTimes)) return null;
  const byKey = new Map<string, DepartureDTO>();
  for (const st of obj.stopTimes) {
    if (!st || !isRailMode(st.mode)) continue;
    // Cancelled events often only carry the scheduled time.
    const departMs = toMs(st.place?.departure) ?? toMs(st.place?.scheduledDeparture);
    if (departMs == null) continue;
    const schedDepartMs = toMs(st.place?.scheduledDeparture) ?? departMs;
    const d: DepartureDTO = {
      tripId: st.tripId || '',
      name: st.displayName || st.routeShortName || '?',
      headsign: st.headsign || '',
      mode: st.mode!,
      category: categoryOf(st.mode!),
      departMs,
      schedDepartMs,
      delayMin: Math.round((departMs - schedDepartMs) / 60000),
      realTime: st.realTime === true,
      track: st.place?.track || null,
      scheduledTrack: st.place?.scheduledTrack || null,
      cancelled: st.cancelled === true || st.tripCancelled === true,
      stopName: st.place?.name || '',
    };
    const key = dedupKey(d);
    const existing = byKey.get(key);
    if (existing) mergeDuplicate(existing, d);
    else if (byKey.size < MAX_DEPARTURES) byKey.set(key, d);
  }
  const departures = [...byKey.values()].sort((a, b) => a.departMs - b.departMs);
  // Queried via center+radius the response place is only the anchor ("center"),
  // not a station name – then the client keeps its own (ISR) name.
  const placeName = obj.place?.name || '';
  return { stationName: placeName === 'center' ? '' : placeName, departures };
}

export class DeparturesService {
  private readonly apiBase: string;
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  /** Burst cache: one entry per coordinate key (rate-limit protection). */
  private readonly cache: TtlCache<string, DeparturesResult>;
  /** Single flight: concurrent requests per station share one upstream call. */
  private readonly inflight = new SingleFlight<string, DeparturesResult>();

  constructor(opts?: { apiBase?: string; ttlMs?: number; fetchFn?: typeof fetch }) {
    this.apiBase = opts?.apiBase ?? DEPARTURES_API;
    this.ttlMs = opts?.ttlMs ?? DEPARTURES_TTL_MS;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.cache = new TtlCache(this.ttlMs);
  }

  /** Empty result with an error message (pattern as in LiveTripsService). */
  private static empty(error: string): DeparturesResult {
    return { stationName: '', departures: [], generatedAt: new Date().toISOString(), error };
  }

  /** Coordinate key rounded to ~10 m: clicks on the same station share the cache. */
  private static key(lat: number, lon: number): string {
    return `${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

  private buildUrl(lat: number, lon: number): string {
    const params = new URLSearchParams({
      center: `${lat.toFixed(5)},${lon.toFixed(5)}`,
      radius: String(STOP_RADIUS_M),
      n: String(N_DEPARTURES),
      arriveBy: 'false',
      // Railway only – the map is a railway map (same filter as live trains).
      mode: [...RAIL_MODES].join(','),
      language: 'de',
    });
    return `${this.apiBase}?${params.toString()}`;
  }

  /**
   * Cached (TTL per coordinate, single flight). NEVER throws: on error the
   * (possibly stale) cached state is returned with `error` set, otherwise an
   * empty result with `error`. Error results are cached for the TTL too
   * (negative caching), so the burst protection survives upstream outages.
   */
  async getDepartures(lat: number, lon: number): Promise<DeparturesResult> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return DeparturesService.empty('Ungültige Koordinaten');
    }
    const key = DeparturesService.key(lat, lon);
    const hit = this.cache.get(key);
    if (hit) return hit;
    return this.inflight.run(key, () => this.fetchAndCache(key, lat, lon));
  }

  /** Performs the upstream fetch and stores the result OR the error under a fresh ts. */
  private async fetchAndCache(key: string, lat: number, lon: number): Promise<DeparturesResult> {
    const previous = this.cache.getStale(key);
    try {
      const res = await this.fetchFn(this.buildUrl(lat, lon), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} bei stoptimes`);
      const normalized = normalizeDepartures((await res.json()) as unknown);
      if (!normalized) throw new Error('Antwort ohne stopTimes');
      const data: DeparturesResult = { ...normalized, generatedAt: new Date().toISOString(), error: null };
      this.cache.set(key, data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const data = previous
        ? { ...previous, error: msg } // last good state, but flagged with the error
        : DeparturesService.empty(msg);
      this.cache.set(key, data); // negative caching (burst protection)
      return data;
    }
  }
}
