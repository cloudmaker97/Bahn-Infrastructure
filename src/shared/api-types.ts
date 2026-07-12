// Shared API contract between the Node server and the web frontend.
// Everything here is serialized as JSON over our own /api/* endpoints and is the
// single source of truth for both sides (the web imports it via @shared/api-types).
import type { TrainCategory, TrainDTO } from './live-trips-core.js';

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

// --- Trip details (Transitous trip API) contract: GET /api/trip?tripId= ---

/** One stop of a trip; times in epoch ms (null = the stop has no such time). */
export interface TripStopDTO {
  name: string;
  arriveMs: number | null;
  schedArriveMs: number | null;
  departMs: number | null;
  schedDepartMs: number | null;
  track: string | null;
  cancelled: boolean;
}

/** Response of GET /api/trip?tripId= (server cache: 30 s per trip). */
export interface TripDetailsResult {
  /** Display name of the train, e.g. "ICE 1032". */
  name: string;
  /** Destination board text of the trip. */
  headsign: string;
  realTime: boolean;
  stops: TripStopDTO[];
  /** Upstream error; possibly combined with the last cached state in `stops`. */
  error: string | null;
}

// --- Departures (Transitous stoptimes API) contract: GET /api/departures?lat=&lon= ---

/** One departure event at a station; times in epoch ms. */
export interface DepartureDTO {
  /** Transitous trip id (key/detail lookup); may be empty. */
  tripId: string;
  /** Display name of the train, e.g. "ICE 577". */
  name: string;
  /** Destination board text. */
  headsign: string;
  mode: string;
  category: TrainCategory;
  departMs: number;
  schedDepartMs: number;
  delayMin: number;
  realTime: boolean;
  track: string | null;
  scheduledTrack: string | null;
  cancelled: boolean;
  /** Name of the actual stop the event belongs to (child stop of the station). */
  stopName: string;
}

/** Response of GET /api/departures?lat=&lon= (server cache: 30 s per station). */
export interface DeparturesResult {
  /** Resolved stop name from Transitous (may differ from the ISR name). */
  stationName: string;
  departures: DepartureDTO[];
  generatedAt: string;
  /** Upstream error; possibly combined with the last cached state in `departures`. */
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

// --- Network status (strecken-info.de) contract: GET /api/streckeninfo ---

/** Category discriminator in the GeoJSON feature properties (`category`). */
export type NetworkStatusCategory = 'disruption' | 'construction' | 'closure';

/** One effect of a disruption, with the transport modes it applies to. */
export interface EffectDTO {
  effect: string;
  transportModes: string[];
}

/** One validity window of a construction site / line closure. */
export interface ValidityDTO {
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  weekdays?: string[]; // upstream values MONTAG..SONNTAG (displayed as-is)
  startTime?: string; // "HH:MM:SS"
  endTime?: string; // "HH:MM:SS"
}

/** Aggregate notice (no geometry) from GET /api/streckeninfo. */
export interface AggregateNoticeDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  start: string;
  end: string;
  transportModes: string[];
}

/** Disruption notice for lists/TUI (geometry-independent). */
export interface DisruptionNoticeDTO extends AggregateNoticeDTO {
  trackRestriction: string;
  located: boolean; // does the disruption have a resolvable geometry?
}

/** Response of GET /api/streckeninfo (server-cached, TTL 3 min). */
export interface NetworkStatusResult {
  disruptions: FeatureCollection; // only located AND currently active (for the map)
  constructionSites: FeatureCollection;
  lineClosures: FeatureCollection;
  aggregateNotices: AggregateNoticeDTO[];
  disruptionNotices: DisruptionNoticeDTO[]; // ALL active disruptions (also unlocated) for lists/TUI
  generatedAt: string;
  counts: {
    disruptions: number;
    unlocatedDisruptions: number;
    constructionSites: number;
    lineClosures: number;
    aggregateNotices: number;
  };
  error: string | null;
}
