// Client-side view of the server API responses. All contract types come from
// src/shared/api-types.ts (single source for server AND web, via the @shared/*
// alias) — no local duplicates.
import type { TrainDTO } from '@shared/live-trips-core';

export type { TrainDTO };

export type {
  VersionInfo, LiveTripsResult, LatLng, StationSuggestion,
  RouteMode, RouteWaypoint, RouteSegment, RouteResult, RouteError, RouteResponse,
} from '@shared/api-types';

/** Sammelmeldung (no geometry) from GET /api/streckeninfo. */
export interface SammelmeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
}

/** Response of GET /api/streckeninfo (server-cached, TTL 3 min). */
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
