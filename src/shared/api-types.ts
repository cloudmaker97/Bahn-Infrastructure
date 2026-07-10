// Shared API contract between the Node server and the web frontend.
// Everything here is serialized as JSON over our own /api/* endpoints and is the
// single source of truth for both sides (the web imports it via @shared/api-types).
import type { TrainDTO } from './live-trips-core.js';

/** A point as [lat, lon] (convention of the route API). */
export type LatLng = [number, number];

/** Minimal framework-free GeoJSON feature (also used for /data/*.geojson payloads). */
export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: {
    type: 'MultiLineString' | 'MultiPoint' | 'LineString' | 'Point';
    coordinates: unknown;
  } | null;
  properties: P;
}

/** Minimal framework-free GeoJSON feature collection. */
export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: GeoFeature<P>[];
  totalFeatures?: number;
}

/** Response of GET /api/version. */
export interface VersionInfo {
  version: string;
}

/** Response of GET /api/livetrips?zoom=N (server cache: 10 s per zoom bucket). */
export interface LiveTripsResult {
  generatedAt: string;
  trains: TrainDTO[];
  /** Upstream error; possibly combined with the last cached state in `trains`. */
  error: string | null;
}

/**
 * Autocomplete suggestion from GET /api/stations?q= — also the server's domain
 * shape for an operating point (Betriebsstelle), i.e. a node of the network.
 */
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
  line: number | undefined;
  timeMin: number;
  distKm: number;
  coords: LatLng[];
}

/** Success response of GET /api/route. */
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

/** Error response of GET /api/route (HTTP 400, but always JSON). */
export interface RouteError {
  ok: false;
  error: string;
}

export type RouteResponse = RouteResult | RouteError;
