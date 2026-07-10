// Fetches the current network status (disruptions, construction sites, line
// closures, aggregate notices) from strecken-info.de and serves it as GeoJSON.
// Responsibility: network access + TTL cache (SRP). The pure transforms live in
// transform.ts so they stay testable without network access.
import type {
  AlignmentLookup,
  NetworkStatusResult,
  StationLookup,
} from '../../types.js';
import type {
  CoordResolver,
  RawConstructionSite,
  RawDisruption,
  RawLineClosure,
} from './wire.js';
import { buildGeoJson } from './transform.js';

export type { NetworkStatusResult, AggregateNoticeDTO, DisruptionNoticeDTO } from '../../types.js';

// --- Network constants ---

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'JavaScript',
  Origin: 'https://strecken-info.de',
  Referer: 'https://strecken-info.de/',
  'User-Agent': 'Mozilla/5.0',
};

// Mandatory filter: an empty regionalbereiche array returns almost nothing!
// (Request body wire format – keys must stay as-is.)
const FILTER = {
  baustellenAktiv: true,
  baustellenNurTotalsperrung: false,
  streckenruhenAktiv: true,
  stoerungenAktiv: true,
  wirkungsdauer: 0,
  zeitraum: { type: 'ROLLIEREND', stunden: 0 },
  regionalbereiche: ['NORD', 'OST', 'SUED', 'SUEDOST', 'SUEDWEST', 'WEST', 'MITTE'],
  streckennummern: [] as number[],
  betriebsstellen: [] as string[],
} as const;

const WS_TIMEOUT_MS = 12_000;

// --- Service (network + cache) ---

export class NetworkStatusService {
  private readonly apiBase: string;
  private readonly wsUrl: string;
  private readonly ttlMs: number;
  private readonly onRefresh: (() => void) | null;
  private readonly alignment: AlignmentLookup | undefined;
  private cache: { data: NetworkStatusResult; ts: number } | null = null;

  constructor(
    private stations: StationLookup,
    opts?: {
      apiBase?: string; wsUrl?: string; ttlMs?: number; onRefresh?: () => void;
      /** Real track alignment for notices (instead of straight lines); optional. */
      alignment?: AlignmentLookup;
    },
  ) {
    this.apiBase = opts?.apiBase ?? 'https://strecken-info.de/api';
    this.wsUrl = opts?.wsUrl ?? 'wss://strecken-info.de/api/websocket';
    this.ttlMs = opts?.ttlMs ?? 180_000;
    this.onRefresh = opts?.onRefresh ?? null;
    this.alignment = opts?.alignment;
  }

  /**
   * Discards the result cache (e.g. after a data reload: the cached GeoJSON was
   * built with the old graph geometries). The next getData() call then scrapes
   * and builds fresh.
   */
  invalidate(): void {
    this.cache = null;
  }

  /** Resolves an RL100 via the ISR operating points to [lon, lat]. */
  private resolveCoord: CoordResolver = (ril100) => {
    const stel = this.stations.resolveStel(ril100.trim());
    if (stel == null) return null;
    const s = this.stations.getStation(stel);
    if (!s || s.lat == null || s.lon == null) return null;
    return [s.lon, s.lat];
  };

  /** Empty result with an optional error message. */
  private static empty(error: string | null, generatedAt: string): NetworkStatusResult {
    return {
      disruptions: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      constructionSites: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      lineClosures: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      aggregateNotices: [],
      disruptionNotices: [],
      generatedAt,
      counts: { disruptions: 0, unlocatedDisruptions: 0, constructionSites: 0, lineClosures: 0, aggregateNotices: 0 },
      error,
    };
  }

  /** Opens the WS once and reads the revision from the first handshake message. */
  private fetchRevisionOnce(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error('WebSocket-Timeout beim Revision-Handshake')));
      }, WS_TIMEOUT_MS);

      ws.onmessage = (ev: MessageEvent) => {
        if (settled) return;
        try {
          const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
          const msg = JSON.parse(text) as { revision?: { nummer?: number } };
          const nummer = msg.revision?.nummer;
          if (typeof nummer === 'number') finish(() => resolve(nummer));
          // Message without a revision: keep waiting (until timeout).
        } catch {
          finish(() => reject(new Error('WebSocket-Nachricht nicht parsebar')));
        }
      };
      ws.onerror = () => finish(() => reject(new Error('WebSocket-Fehler')));
      ws.onclose = () => finish(() => reject(new Error('WebSocket geschlossen ohne Revision')));
    });
  }

  /** Fetches the revision with one retry. */
  private async fetchRevision(): Promise<number> {
    try {
      return await this.fetchRevisionOnce();
    } catch {
      return await this.fetchRevisionOnce();
    }
  }

  /** POST to a data endpoint with {revision, filter}. */
  private async post<T>(path: string, revision: number): Promise<T> {
    const res = await fetch(`${this.apiBase}/${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ revision, filter: FILTER }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${path}`);
    return (await res.json()) as T;
  }

  /**
   * Cached (TTL). NEVER throws: on error the (possibly stale) cached result is
   * returned with `error` set, otherwise an empty result with `error`.
   */
  async getData(opts?: { force?: boolean }): Promise<NetworkStatusResult> {
    const nowMs = Date.now();
    if (!opts?.force && this.cache && nowMs - this.cache.ts < this.ttlMs) {
      return this.cache.data;
    }

    try {
      const revision = await this.fetchRevision();
      const [stoerungen, baustellen, streckenruhen, sammelmeldungen] = await Promise.all([
        this.post<RawDisruption[]>('stoerungen', revision),
        this.post<RawConstructionSite[]>('baustellen', revision),
        this.post<RawLineClosure[]>('streckenruhen', revision),
        this.post<RawDisruption[]>('stoerungen/sammelmeldungen', revision),
      ]);

      const now = new Date();
      const built = buildGeoJson(
        { stoerungen, baustellen, streckenruhen, sammelmeldungen },
        now,
        this.resolveCoord,
        this.alignment,
      );
      const data: NetworkStatusResult = { ...built, generatedAt: now.toISOString(), error: null };
      this.cache = { data, ts: nowMs };
      try {
        if (this.onRefresh) this.onRefresh(); // only after a real scrape
      } catch {
        /* do not count callback errors as scrape errors */
      }
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.cache) return { ...this.cache.data, error: msg };
      return NetworkStatusService.empty(msg, new Date().toISOString());
    }
  }
}
