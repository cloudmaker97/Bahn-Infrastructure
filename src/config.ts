// Central configuration: paths, WFS endpoint, layer definitions.
// The layer keys also name the on-disk artifacts (geo_<key>.json,
// map_<key>.geojson) and the /data/ URLs – treat them as a persisted format.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_RAW = join(ROOT, 'data', 'raw');
export const DATA_WEB = join(ROOT, 'data', 'web');
/** Static frontend: the Next.js export (web/out, created via `npm run build:web`). */
export const WEB_OUT = join(ROOT, 'web', 'out');

// Defaults to 0 -> the OS assigns a free (random) port at startup.
// The PORT environment variable forces a fixed port (e.g. for tests).
export const PORT = process.env.PORT ? Number(process.env.PORT) : 0;
export const DEFAULT_SPEED = 50; // km/h fallback for sections without a speed

// Scheduled full data refresh (re-scrape + rebuild + hot reload) on long-running
// servers. DATA_REFRESH_HOURS overrides the 12 h default; 0 (or an invalid
// value) disables the schedule – manual refresh (TUI Ctrl+R) keeps working.
const refreshHours = process.env.DATA_REFRESH_HOURS ? Number(process.env.DATA_REFRESH_HOURS) : 12;
export const DATA_REFRESH_INTERVAL_MS = Number.isFinite(refreshHours) && refreshHours > 0
  ? refreshHours * 60 * 60 * 1000
  : 0;

export const WFS_BASE = 'https://geoviewer.deutschebahn.com/geoviewer-geoserver/ows';

/** strecken-info.de – source of the live network status (construction, disruptions, closures). */
export const NETWORK_STATUS_API = 'https://strecken-info.de/api';
/** WebSocket for the initial handshake (delivers the current revision number). */
export const NETWORK_STATUS_WS = 'wss://strecken-info.de/api/websocket';
/** Cache duration of the network-status data (ms) – limits requests to strecken-info.de. */
export const NETWORK_STATUS_TTL_MS = 3 * 60 * 1000;

/** Transitous map/trips – source of the live train positions (server is authoritative). */
export const LIVETRIPS_API = 'https://api.transitous.org/api/v6/map/trips';
/** Burst cache per zoom bucket (rate-limit protection towards Transitous). */
export const LIVETRIPS_TTL_MS = 10_000;

/** Transitous trip – source of the per-trip schedule (all stops with times). */
export const TRIP_API = 'https://api.transitous.org/api/v6/trip';
/** Cache duration of trip details per tripId (delays change, lines rarely). */
export const TRIP_TTL_MS = 30_000;

/** Transitous stoptimes – source of the next departures at a station. */
export const DEPARTURES_API = 'https://api.transitous.org/api/v6/stoptimes';
/** Cache duration of departures per station coordinate (delays change often). */
export const DEPARTURES_TTL_MS = 30_000;

/** All layers that are scraped and/or built into the map. */
export interface LayerDef {
  key: string;
  typeName: string;
  geom: 'line' | 'point';
  /** Curated display field set for the web GeoJSON (empty = all non-empty fields). */
  whitelist?: string[];
}

export const LAYERS: LayerDef[] = [
  {
    key: 'streckenabschnitte',
    typeName: 'ISR:ISR_V_GEO_STRECKENABSCHNITTE',
    geom: 'line',
    whitelist: [
      'ISR_STRE_NR', 'STRECKEN_ABSCHNITT', 'ISR_STRECKE_VON_BIS',
      'ISR_STEL_ID_VON', 'ISR_STEL_ID_BIS',
      'ISR_KM_VON', 'ISR_KM_BIS', 'ALG_LAENGE_ABSCHNITT',
      'ALG_INFRA_BETR', 'ALG_STAAT', 'ALG_STRECKENKLASSE', 'ALG_VERKEHRSART',
      'ALG_TEN_KLASSIFIZIERUNG_PV', 'ALG_TEN_KLASSIFIZIERUNG_GV',
      'ALG_MIN_LIRA_PROFIL', 'ALG_KV_PROFIL',
      'INF_GLEISANZAHL', 'INF_TRAKTIONSART', 'INF_KOMM_SYSTEM',
      'BET_GESCHWINDIGKEIT', 'BET_GESCHWINDIGKEIT_CLUSTER',
      'LST_PZB', 'LST_LZB', 'LST_ETCS_LEVEL_VERS', 'ENE_TRAKT_STROMART',
    ],
  },
  { key: 'streckenuebergaenge', typeName: 'ISR:ISR_V_GEO_STRECKENUEBERGAENGE', geom: 'point' },
  { key: 'betriebsstellen', typeName: 'ISR:ISR_V_GEO_BETRIEBSSTELLEN_PUNKT', geom: 'point' },
  { key: 'tunnel', typeName: 'ISR:ISR_V_GEO_TUNNEL', geom: 'line' },
  { key: 'bruecken', typeName: 'ISR:ISR_V_GEO_BRUECKE_ISR', geom: 'line' },
  { key: 'bahnuebergaenge', typeName: 'ISR:ISR_V_GEO_BAHNUEBERGAENGE', geom: 'point' },
];

/** Values that count as "empty" and are removed from the web GeoJSON. */
export const NOISE = new Set([
  '', '-', 'auf Anfrage', 'Kein Dokument vorhanden',
  'kein Dokument vorhanden', 'Kein Dokument vorhanden.',
]);
