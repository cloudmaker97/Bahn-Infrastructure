// Response-Typen der eigenen Server-APIs – Client-Sicht, nachgezogen aus
// src/types.ts, src/routing/route-service.ts und src/server/api-router.ts.
// TrainDTO kommt aus der gemeinsamen reinen Logik (eine Quelle, kein Duplikat).
import type { TrainDTO } from '@shared/live-trips-core';

export type { TrainDTO };

/** Antwort von GET /api/version. */
export interface VersionInfo {
  version: string;
}

/** Antwort von GET /api/livetrips?zoom=N (Server-Cache 10 s je Zoom-Bucket). */
export interface LiveTripsResult {
  generatedAt: string; // ISO-Zeitstempel (siehe src/data/live-trips-service.ts)
  trains: TrainDTO[];
  /** Upstream-Fehler; ggf. mit letztem Cache-Stand in `trains` kombiniert. */
  error: string | null;
}

/** Ein Punkt als [lat, lon] (Leaflet-Konvention des Backends). */
export type LatLng = [number, number];

/** Autocomplete-Vorschlag von GET /api/stations?q= (Station aus src/types.ts). */
export interface StationSuggestion {
  stel: number;
  rl100: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
}

export type RouteMode = 'fast' | 'short';

export interface RouteWaypoint {
  stel: number;
  rl100: string | null;
  name: string | null;
  lat: number | null;
  lon: number | null;
}

export interface RouteSegment {
  strecke: number | undefined;
  timeMin: number;
  distKm: number;
  coords: LatLng[];
}

/** Erfolgsantwort von GET /api/route. */
export interface RouteResult {
  ok: true;
  mode: RouteMode;
  from: RouteWaypoint;
  to: RouteWaypoint;
  totalTimeMin: number;
  totalDistKm: number;
  nEdges: number;
  nWaypoints: number;
  waypoints: RouteWaypoint[];
  segments: RouteSegment[];
}

/** Fehlerantwort von GET /api/route (HTTP 400, aber immer JSON). */
export interface RouteError {
  ok: false;
  error: string;
}

export type RouteResponse = RouteResult | RouteError;

/** Sammelmeldung (ohne Geo) aus GET /api/streckeninfo. */
export interface SammelmeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
}

/** Antwort von GET /api/streckeninfo (server-gecacht, TTL 3 min). */
export interface StreckenInfoResult {
  stoerungen: GeoJSON.FeatureCollection;
  baustellen: GeoJSON.FeatureCollection;
  streckenruhen: GeoJSON.FeatureCollection;
  sammelmeldungen: SammelmeldungDTO[];
  generatedAt: string;
  counts: {
    stoerungen: number;
    stoerungenOhneOrt: number;
    baustellen: number;
    streckenruhen: number;
    sammelmeldungen: number;
  };
  error: string | null;
}
