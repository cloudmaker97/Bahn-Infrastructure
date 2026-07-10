// Fetches live train positions from Transitous (map/trips) and returns
// normalized TrainDTOs for /api/livetrips. Responsibility: upstream fetch +
// burst cache per zoom bucket (SRP). The pure normalization lives in
// src/shared/ (DRY); fetch is injectable (DIP) so the service is testable
// without network access.
import { LIVETRIPS_API, LIVETRIPS_TTL_MS } from '../config.js';
import { ringsBbox } from '../shared/geo.js';
import { DE_BOUNDARY_RINGS } from '../shared/de-boundary.js';
import { normalizeTrips } from '../shared/live-trips-core.js';
import { SingleFlight, TtlCache } from '../core/ttl-cache.js';
import type { LiveTripsResult } from '../shared/api-types.js';

export type { LiveTripsResult } from '../shared/api-types.js';

/** Bounding box of the German boundary – constant, so computed once. */
const DE_BBOX = ringsBbox(DE_BOUNDARY_RINGS);

/** Time window of the upstream query (map/trips requires startTime/endTime). */
const TIME_WINDOW_MS = 30_000;

/**
 * Maximum zoom bucket: Transitous rejects the Germany-wide bbox from zoom 9 on
 * with HTTP 422 (bbox too large for the zoom). Zoom 8 returns ~2.5 MB nationwide
 * with sufficient polyline detail; higher client zooms use the same bucket.
 */
const MAX_BUCKET = 8;
const MIN_BUCKET = 3;

/** Upstream timeout: a hanging Transitous must not block /api/livetrips. */
const FETCH_TIMEOUT_MS = 12_000;

export class LiveTripsService {
  private readonly apiBase: string;
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  /** Burst cache: one entry per zoom bucket (rate-limit protection). */
  private readonly cache: TtlCache<number, LiveTripsResult>;
  /** Single flight: concurrent requests per bucket share one upstream call. */
  private readonly inflight = new SingleFlight<number, LiveTripsResult>();

  constructor(opts?: { apiBase?: string; ttlMs?: number; fetchFn?: typeof fetch }) {
    this.apiBase = opts?.apiBase ?? LIVETRIPS_API;
    this.ttlMs = opts?.ttlMs ?? LIVETRIPS_TTL_MS;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.cache = new TtlCache(this.ttlMs);
  }

  /** Empty result with an optional error message (pattern as in NetworkStatusService). */
  private static empty(error: string | null, generatedAt: string): LiveTripsResult {
    return { generatedAt, trains: [], error };
  }

  /** Upstream URL: always the DE bbox, time window now..+30 s, zoom = bucket. */
  private buildUrl(bucket: number, nowMs: number): string {
    const params = new URLSearchParams({
      min: `${DE_BBOX.minLat},${DE_BBOX.minLon}`,
      max: `${DE_BBOX.maxLat},${DE_BBOX.maxLon}`,
      startTime: new Date(nowMs).toISOString(),
      endTime: new Date(nowMs + TIME_WINDOW_MS).toISOString(),
      zoom: String(bucket),
    });
    return `${this.apiBase}?${params.toString()}`;
  }

  /**
   * Cached (TTL per zoom bucket, single flight). NEVER throws: on error the
   * (possibly stale) cached state is returned with `error` set, otherwise an
   * empty result with `error`. Error results are cached for the TTL too
   * (negative caching), so the burst protection survives upstream outages.
   */
  async getTrains(zoom: number): Promise<LiveTripsResult> {
    // Zoom bucket [MIN..MAX] as the cache key; unusable values fall back to 6.
    const bucket = Math.min(MAX_BUCKET, Math.max(MIN_BUCKET, Math.round(Number.isFinite(zoom) ? zoom : 6)));
    const hit = this.cache.get(bucket);
    if (hit) return hit;

    // Single flight: when a fetch for this bucket is already running, share its result.
    return this.inflight.run(bucket, () => this.fetchAndCache(bucket));
  }

  /** Performs the upstream fetch and stores the result OR the error under a fresh ts. */
  private async fetchAndCache(bucket: number): Promise<LiveTripsResult> {
    const nowMs = Date.now();
    const previous = this.cache.getStale(bucket);
    try {
      const res = await this.fetchFn(this.buildUrl(bucket, nowMs), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} bei map/trips`);
      const raw = (await res.json()) as unknown;
      // Server-side DE filter: only trains whose current position is inside Germany.
      const trains = normalizeTrips(raw, nowMs, DE_BOUNDARY_RINGS);
      const data: LiveTripsResult = { generatedAt: new Date(nowMs).toISOString(), trains, error: null };
      this.cache.set(bucket, data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const data = previous
        ? { ...previous, error: msg } // last good state, but flagged with the error
        : LiveTripsService.empty(msg, new Date(nowMs).toISOString());
      this.cache.set(bucket, data); // negative caching (burst protection)
      return data;
    }
  }
}
