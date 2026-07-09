// Holt Live-Zugpositionen von Transitous (map/trips) und liefert normalisierte
// TrainDTOs für /api/livetrips. Verantwortung: Upstream-Abruf + Burst-Cache je
// Zoom-Bucket (SRP). Die reine Normalisierung lebt in src/shared/ (DRY); fetch
// ist injizierbar (DIP), damit der Service ohne Netz testbar bleibt.
import { LIVETRIPS_API, LIVETRIPS_TTL_MS } from '../config.js';
import { ringsBbox } from '../shared/geo.js';
import { DE_BOUNDARY_RINGS } from '../shared/de-boundary.js';
import { normalizeTrips, type TrainDTO } from '../shared/live-trips-core.js';

/** Antwort von /api/livetrips: Zeitstempel, Züge und evtl. Fehlertext. */
export interface LiveTripsResult {
  generatedAt: string;
  trains: TrainDTO[];
  error: string | null;
}

/** Bounding-Box der Deutschland-Grenze – konstant, daher einmal vorberechnet. */
const DE_BBOX = ringsBbox(DE_BOUNDARY_RINGS);

/** Zeitfenster der Upstream-Abfrage (map/trips verlangt startTime/endTime). */
const ZEITFENSTER_MS = 30_000;

/**
 * Maximaler Zoom-Bucket: Transitous lehnt die deutschlandweite Bbox ab Zoom 9 mit
 * HTTP 422 ab (Bbox zu groß für den Zoom). Zoom 8 liefert bundesweit ~2,5 MB und
 * ausreichende Polyline-Detailtiefe; höhere Client-Zooms nutzen denselben Bucket.
 */
const MAX_BUCKET = 8;
const MIN_BUCKET = 3;

/** Upstream-Timeout: ein hängender Transitous darf /api/livetrips nicht blockieren. */
const FETCH_TIMEOUT_MS = 12_000;

export class LiveTripsService {
  private readonly apiBase: string;
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  /** Burst-Cache: ein Eintrag je Zoom-Bucket (Rate-Limit-Schutz). */
  private readonly cache = new Map<number, { data: LiveTripsResult; ts: number }>();
  /** Single-Flight: laufende Upstream-Abrufe je Bucket (parallele Anfragen teilen sich einen Call). */
  private readonly inflight = new Map<number, Promise<LiveTripsResult>>();

  constructor(opts?: { apiBase?: string; ttlMs?: number; fetchFn?: typeof fetch }) {
    this.apiBase = opts?.apiBase ?? LIVETRIPS_API;
    this.ttlMs = opts?.ttlMs ?? LIVETRIPS_TTL_MS;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
  }

  /** Leeres Ergebnis mit optionaler Fehlermeldung (Muster wie StreckenInfoService). */
  private static empty(error: string | null, generatedAt: string): LiveTripsResult {
    return { generatedAt, trains: [], error };
  }

  /** Upstream-URL: immer die DE-Bbox, Zeitfenster jetzt..+30 s, Zoom = Bucket. */
  private buildUrl(bucket: number, nowMs: number): string {
    const params = new URLSearchParams({
      min: `${DE_BBOX.minLat},${DE_BBOX.minLon}`,
      max: `${DE_BBOX.maxLat},${DE_BBOX.maxLon}`,
      startTime: new Date(nowMs).toISOString(),
      endTime: new Date(nowMs + ZEITFENSTER_MS).toISOString(),
      zoom: String(bucket),
    });
    return `${this.apiBase}?${params.toString()}`;
  }

  /**
   * Gecacht (TTL je Zoom-Bucket, Single-Flight). Wirft NIE: bei Fehler wird der (auch
   * veraltete) Cache-Stand mit gesetztem `error` geliefert, sonst ein leeres Ergebnis
   * mit `error`. Auch Fehler-Ergebnisse werden für die TTL gecacht (negatives Caching),
   * damit der Burst-Schutz bei Upstream-Störungen erhalten bleibt.
   */
  async getTrains(zoom: number): Promise<LiveTripsResult> {
    // Zoom-Bucket [MIN..MAX] als Cache-Key; unbrauchbare Werte fallen auf 6 zurück.
    const bucket = Math.min(MAX_BUCKET, Math.max(MIN_BUCKET, Math.round(Number.isFinite(zoom) ? zoom : 6)));
    const hit = this.cache.get(bucket);
    if (hit && Date.now() - hit.ts < this.ttlMs) return hit.data;

    // Single-Flight: läuft für diesen Bucket bereits ein Abruf, dessen Ergebnis teilen.
    const laufend = this.inflight.get(bucket);
    if (laufend) return laufend;
    const abruf = this.holeUndCache(bucket).finally(() => this.inflight.delete(bucket));
    this.inflight.set(bucket, abruf);
    return abruf;
  }

  /** Führt den Upstream-Abruf aus und legt Ergebnis ODER Fehler unter aktueller ts ab. */
  private async holeUndCache(bucket: number): Promise<LiveTripsResult> {
    const nowMs = Date.now();
    const alt = this.cache.get(bucket);
    try {
      const res = await this.fetchFn(this.buildUrl(bucket, nowMs), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} bei map/trips`);
      const raw = (await res.json()) as unknown;
      // Serverseitiger DE-Filter: nur Züge, deren aktuelle Position in Deutschland liegt.
      const trains = normalizeTrips(raw, nowMs, DE_BOUNDARY_RINGS);
      const data: LiveTripsResult = { generatedAt: new Date(nowMs).toISOString(), trains, error: null };
      this.cache.set(bucket, { data, ts: nowMs });
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const data = alt
        ? { ...alt.data, error: msg } // letzter guter Stand, aber mit Fehlermarkierung
        : LiveTripsService.empty(msg, new Date(nowMs).toISOString());
      this.cache.set(bucket, { data, ts: nowMs }); // negatives Caching (Burst-Schutz)
      return data;
    }
  }
}
