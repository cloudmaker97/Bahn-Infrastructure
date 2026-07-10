// Fetches a single trip (the full schedule with all stops) from the Transitous
// trip API and returns a slim TripDetailsResult for /api/trip. Responsibility:
// upstream fetch + short TTL cache per tripId (SRP). The normalization is a
// pure exported function and fetch is injectable (DIP), so the service is
// testable without network access (pattern as in LiveTripsService).
import { TRIP_API, TRIP_TTL_MS } from '../config.js';
import { SingleFlight, TtlCache } from '../core/ttl-cache.js';
import type { TripDetailsResult, TripStopDTO } from '../shared/api-types.js';

export type { TripDetailsResult } from '../shared/api-types.js';

/** Upstream timeout: a hanging Transitous must not block /api/trip. */
const FETCH_TIMEOUT_MS = 12_000;

/** Cap against degenerate upstream data (no real trip has this many stops). */
const MAX_STOPS = 500;

/** Narrow view of a raw Transitous place (only the fields we use). */
interface RawPlace {
  name?: string;
  arrival?: string;
  scheduledArrival?: string;
  departure?: string;
  scheduledDeparture?: string;
  track?: string;
  cancelled?: boolean;
}

/** Narrow view of a raw Transitous itinerary leg (only the fields we use). */
interface RawLeg {
  displayName?: string;
  headsign?: string;
  realTime?: boolean;
  from?: RawPlace;
  to?: RawPlace;
  intermediateStops?: RawPlace[];
}

function toMs(iso: string | undefined): number | null {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? ms : null;
}

function toStop(p: RawPlace): TripStopDTO {
  return {
    name: p.name || '?',
    arriveMs: toMs(p.arrival),
    schedArriveMs: toMs(p.scheduledArrival),
    departMs: toMs(p.departure),
    schedDepartMs: toMs(p.scheduledDeparture),
    track: p.track || null,
    cancelled: p.cancelled === true,
  };
}

/**
 * Converts a raw Transitous trip itinerary into the slim stop list. Legs are
 * concatenated; the seam stop ("to" of leg N = "from" of leg N+1) is merged so
 * it appears once with arrival AND departure. Returns null when the response
 * carries no usable stops.
 */
export function normalizeTripDetails(raw: unknown): Omit<TripDetailsResult, 'error'> | null {
  const legs = (raw as { legs?: RawLeg[] } | null)?.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const stops: TripStopDTO[] = [];
  for (const leg of legs) {
    const legStops = [leg.from, ...(leg.intermediateStops ?? []), leg.to]
      .filter((p): p is RawPlace => p != null)
      .map(toStop);
    for (const stop of legStops) {
      const last = stops[stops.length - 1];
      if (last && last.name === stop.name) {
        // Seam between two legs: take departure/track of the continuation.
        last.departMs = stop.departMs ?? last.departMs;
        last.schedDepartMs = stop.schedDepartMs ?? last.schedDepartMs;
        last.track = last.track ?? stop.track;
        last.cancelled = last.cancelled || stop.cancelled;
      } else if (stops.length < MAX_STOPS) {
        stops.push(stop);
      }
    }
  }
  if (!stops.length) return null;
  return {
    name: legs[0]!.displayName || '',
    headsign: legs[legs.length - 1]!.headsign || '',
    realTime: legs.some((l) => l.realTime === true),
    stops,
  };
}

export class TripDetailsService {
  private readonly apiBase: string;
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  /** Burst cache: one entry per tripId (delays change, lines rarely). */
  private readonly cache: TtlCache<string, TripDetailsResult>;
  /** Single flight: concurrent requests per trip share one upstream call. */
  private readonly inflight = new SingleFlight<string, TripDetailsResult>();

  constructor(opts?: { apiBase?: string; ttlMs?: number; fetchFn?: typeof fetch }) {
    this.apiBase = opts?.apiBase ?? TRIP_API;
    this.ttlMs = opts?.ttlMs ?? TRIP_TTL_MS;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.cache = new TtlCache(this.ttlMs);
  }

  /** Empty result with an error message (pattern as in LiveTripsService). */
  private static empty(error: string): TripDetailsResult {
    return { name: '', headsign: '', realTime: false, stops: [], error };
  }

  private buildUrl(tripId: string): string {
    const params = new URLSearchParams({
      tripId,
      joinInterlinedLegs: 'false',
      language: 'de',
    });
    return `${this.apiBase}?${params.toString()}`;
  }

  /**
   * Cached (TTL per tripId, single flight). NEVER throws: on error the
   * (possibly stale) cached state is returned with `error` set, otherwise an
   * empty result with `error`. Error results are cached for the TTL too
   * (negative caching), so the burst protection survives upstream outages.
   */
  async getTrip(tripId: string): Promise<TripDetailsResult> {
    const id = tripId.trim();
    if (!id) return TripDetailsService.empty('tripId fehlt');
    const hit = this.cache.get(id);
    if (hit) return hit;
    return this.inflight.run(id, () => this.fetchAndCache(id));
  }

  /** Performs the upstream fetch and stores the result OR the error under a fresh ts. */
  private async fetchAndCache(tripId: string): Promise<TripDetailsResult> {
    const previous = this.cache.getStale(tripId);
    try {
      const res = await this.fetchFn(this.buildUrl(tripId), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} bei trip`);
      const trip = normalizeTripDetails((await res.json()) as unknown);
      if (!trip) throw new Error('Fahrt ohne verwertbare Halte');
      const data: TripDetailsResult = { ...trip, error: null };
      this.cache.set(tripId, data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const data = previous
        ? { ...previous, error: msg } // last good state, but flagged with the error
        : TripDetailsService.empty(msg);
      this.cache.set(tripId, data); // negative caching (burst protection)
      return data;
    }
  }
}
