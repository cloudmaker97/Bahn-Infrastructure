// Typisierte Fetch-Helfer für die eigenen Server-APIs. Der Server ist federführend:
// der Browser spricht ausschließlich /api/* und /data/* an (im Dev via Next-rewrites
// auf den Node-Server durchgereicht, im Prod gleiche Origin).
import type {
  LiveTripsResult, RouteMode, RouteResponse, StationSuggestion, StreckenInfoResult, VersionInfo,
} from './types';

/** GET + JSON mit Fehlerprüfung (HTTP-Status ≠ 2xx wirft). */
async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

export function getVersion(): Promise<VersionInfo> {
  return getJson<VersionInfo>('/api/version');
}

/** Live-Züge; `zoom` ist der Transitous-Zoom (MapLibre-Zoom + 1, ganzzahlig). */
export function getLiveTrips(zoom: number): Promise<LiveTripsResult> {
  return getJson<LiveTripsResult>(`/api/livetrips?zoom=${Math.round(zoom)}`);
}

export function getStreckenInfo(): Promise<StreckenInfoResult> {
  return getJson<StreckenInfoResult>('/api/streckeninfo');
}

/** Statische GeoJSON-Overlay-Datei (z. B. /data/map_tunnel.geojson). */
export function getGeoJson(url: string): Promise<GeoJSON.FeatureCollection> {
  return getJson<GeoJSON.FeatureCollection>(url);
}

export function getStations(q: string): Promise<StationSuggestion[]> {
  return getJson<StationSuggestion[]>(`/api/stations?q=${encodeURIComponent(q)}`);
}

/** Route berechnen; der Server antwortet auch bei Fehlern (HTTP 400) mit JSON. */
export async function getRoute(from: string, to: string, mode: RouteMode): Promise<RouteResponse> {
  const url = `/api/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`;
  const resp = await fetch(url);
  return resp.json() as Promise<RouteResponse>;
}

/**
 * Lädt eine (große) JSON-Datei und meldet den Fortschritt via Streaming.
 * @param onProgress frac 0..1 wenn Content-Length bekannt, sonst null (unbestimmt)
 */
export async function fetchJsonWithProgress<T>(
  url: string,
  onProgress: (frac: number | null) => void,
): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = Number(resp.headers.get('Content-Length')) || 0;
  if (!resp.body || !total) {
    onProgress(null);
    return resp.json() as Promise<T>;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }
  const merged = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.length;
  }
  return JSON.parse(new TextDecoder().decode(merged)) as T;
}
