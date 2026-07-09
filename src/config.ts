// Zentrale Konfiguration: Pfade, WFS-Endpunkt, Layer-Definitionen.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_RAW = join(ROOT, 'data', 'raw');
export const DATA_WEB = join(ROOT, 'data', 'web');
/** Statisches Frontend: der Next.js-Export (web/out, erzeugt via `npm run build:web`). */
export const WEB_OUT = join(ROOT, 'web', 'out');

// Standardmaessig 0 -> das OS vergibt beim Start einen freien (zufaelligen) Port.
// Mit der Umgebungsvariable PORT laesst sich ein fester Port erzwingen (z. B. Tests).
export const PORT = process.env.PORT ? Number(process.env.PORT) : 0;
export const DEFAULT_SPEED = 50; // km/h Fallback fuer Abschnitte ohne Geschwindigkeit

export const WFS_BASE = 'https://geoviewer.deutschebahn.com/geoviewer-geoserver/ows';

/** strecken-info.de – Quelle der Live-Betriebslage (Baustellen, Störungen, Streckenruhen). */
export const STRECKENINFO_API = 'https://strecken-info.de/api';
/** WebSocket für den initialen Handshake (liefert die aktuelle Revision-Nummer). */
export const STRECKENINFO_WS = 'wss://strecken-info.de/api/websocket';
/** Cache-Dauer der Betriebslage-Daten (ms) – begrenzt Anfragen an strecken-info.de. */
export const STRECKENINFO_TTL_MS = 3 * 60 * 1000;

/** Transitous map/trips – Quelle der Live-Zugpositionen (Server ist federführend). */
export const LIVETRIPS_API = 'https://api.transitous.org/api/v6/map/trips';
/** Burst-Cache je Zoom-Bucket (Rate-Limit-Schutz gegenüber Transitous). */
export const LIVETRIPS_TTL_MS = 10_000;

/** Alle Layer, die gescraped und/oder in die Karte gebaut werden. */
export interface LayerDef {
  key: string;
  typeName: string;
  geom: 'line' | 'point';
  /** kuratiertes Anzeigefeldset fuer die Web-GeoJSON (leer = alle nicht-leeren Felder). */
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

/** Werte, die als "leer" gelten und aus der Web-GeoJSON entfernt werden. */
export const NOISE = new Set([
  '', '-', 'auf Anfrage', 'Kein Dokument vorhanden',
  'kein Dokument vorhanden', 'Kein Dokument vorhanden.',
]);
