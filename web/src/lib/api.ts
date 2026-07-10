// Typed fetch helpers for our own server APIs. The server is authoritative:
// the browser only ever talks to /api/* and /data/* (passed through to the Node
// server via Next rewrites in dev, same origin in prod).
import type {
  LiveTripsResult, NetworkStatusResult, RouteMode, RouteResponse, StationSuggestion, VersionInfo,
} from './types';

/** GET + JSON with error check (HTTP status ≠ 2xx throws). */
async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

export function getVersion(): Promise<VersionInfo> {
  return getJson<VersionInfo>('/api/version');
}

/** Live trains; `zoom` is the Transitous zoom (MapLibre zoom + 1, integer). */
export function getLiveTrips(zoom: number): Promise<LiveTripsResult> {
  return getJson<LiveTripsResult>(`/api/livetrips?zoom=${Math.round(zoom)}`);
}

/** Network status (disruptions/construction/closures); the URL is a stable contract. */
export function getNetworkStatus(): Promise<NetworkStatusResult> {
  return getJson<NetworkStatusResult>('/api/streckeninfo');
}

/** Static GeoJSON overlay file (e.g. /data/map_tunnel.geojson). */
export function getGeoJson(url: string): Promise<GeoJSON.FeatureCollection> {
  return getJson<GeoJSON.FeatureCollection>(url);
}

export function getStations(q: string): Promise<StationSuggestion[]> {
  return getJson<StationSuggestion[]>(`/api/stations?q=${encodeURIComponent(q)}`);
}

/** Computes a route; the server responds with JSON even on errors (HTTP 400). */
export async function getRoute(from: string, to: string, mode: RouteMode): Promise<RouteResponse> {
  const url = `/api/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`;
  const resp = await fetch(url);
  return resp.json() as Promise<RouteResponse>;
}

/**
 * Loads a (large) JSON file and reports streaming progress.
 * @param onProgress frac 0..1 when Content-Length is known, otherwise null (indeterminate)
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
