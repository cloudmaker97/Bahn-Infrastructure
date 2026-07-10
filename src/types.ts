// Shared type definitions for the ISR project: domain types plus the service
// abstractions (DIP/ISP hub). API contract types live in src/shared/api-types.ts
// (single source for server AND web) and are re-exported here for convenience.
import type { FeatureCollection, LatLng, RouteMode, StationSuggestion } from './shared/api-types.js';

export type {
  LatLng, GeoFeature, FeatureCollection,
  VersionInfo, LiveTripsResult, StationSuggestion,
  RouteMode, RouteWaypoint, RouteSegment, RouteResult, RouteError, RouteResponse,
} from './shared/api-types.js';

export type Coord = [number, number]; // [lon, lat] (GeoJSON convention)

/** Properties of a line section (excerpt, graph-relevant). */
export interface AbschnittProps {
  ISR_STRE_NR?: number;
  STRECKEN_ABSCHNITT?: string;
  ISR_STRECKE_VON_BIS?: string;
  ISR_STEL_ID_VON?: number;
  ISR_STEL_ID_BIS?: number;
  ISR_KM_VON?: string;
  ISR_KM_BIS?: string;
  ALG_LAENGE_ABSCHNITT?: string;
  BET_GESCHWINDIGKEIT?: string;
  [key: string]: unknown;
}

/** An operating point (node of the network); same shape as its API suggestion DTO. */
export type Station = StationSuggestion;

/** A graph edge between two operating points. */
export interface Edge {
  to: number;
  timeMin: number;
  distKm: number;
  lineNumber: number | undefined;
  coords: LatLng[];
}

/** Result of a path search in the graph. */
export interface PathResult {
  nodesSeq: number[];
  edges: Edge[];
}

// --- Abstractions (DIP/ISP): high-level modules depend on these, not on classes ---

/** Only the view of operating points that routing needs. */
export interface StationLookup {
  resolveStel(code: string | undefined): number | null;
  getStation(stel: number): Station | undefined;
}

/** Only the view of the graph that routing needs. */
export interface Pathfinder {
  dijkstra(start: number, goal: number, mode: RouteMode, edgeFilter?: (e: Edge) => boolean): PathResult | null;
}

/**
 * Resolves the real course of the line between two operating points (RIL100)
 * into a [lon,lat] chain (GeoJSON order); null when no plausible course can be
 * determined (the caller then falls back to the straight line).
 */
export type VerlaufLookup = (
  vonRil100: string,
  bisRil100: string,
  streckennummern?: number[],
) => [number, number][] | null;

/** Autocomplete suggestions. */
export interface StationSuggester {
  suggest(q: string, limit?: number): Station[];
}

/** Full-text search over all entities. Optionally restricted to one result kind. */
export interface EntitySearch {
  search(q: string, limit?: number, kind?: SearchEntry['kind'] | null): SearchEntry[];
}

/** Returns the sections of a line, or the sections attached to an operating point. */
export interface AbschnittLookup {
  byStrecke(streckenNr: number): AbschnittProps[];
  /** All sections where the operating point (STEL_ID) is start or end. */
  byStation(stel: number): AbschnittProps[];
}

/** A searchable entry for the TUI / search API. */
export interface SearchEntry {
  kind: 'Betriebsstelle' | 'Strecke' | 'Tunnel' | 'Brücke' | 'Bahnübergang';
  code: string; // RL100 / line number / short name
  name: string;
  detail: string; // extra info for display
  data: Record<string, unknown>; // full raw data
}

// --- Public strecken-info data contract (delivered 1:1 as JSON) ---

export interface SammelmeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
}

export interface StoerungMeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
  gleisEinschraenkung: string;
  verortet: boolean; // does the disruption have a resolvable geometry?
}

export interface StreckenInfoResult {
  stoerungen: FeatureCollection; // only located AND currently active (for the map)
  baustellen: FeatureCollection;
  streckenruhen: FeatureCollection;
  sammelmeldungen: SammelmeldungDTO[];
  stoerungenListe: StoerungMeldungDTO[]; // ALL active disruptions (also unlocated) for lists/TUI
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

/** Only the view of the network status that the TUI needs (DIP/ISP). */
export interface MeldungenProvider {
  getData(opts?: { force?: boolean }): Promise<StreckenInfoResult>;
}
