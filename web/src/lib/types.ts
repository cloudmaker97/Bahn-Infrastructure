// Client-side view of the server API responses. All contract types come from
// src/shared/api-types.ts (single source for server AND web, via the @shared/*
// alias) — no local duplicates.
import type { TrainDTO } from '@shared/live-trips-core';

export type { TrainDTO };

export type {
  VersionInfo, LiveTripsResult, LatLng, StationSuggestion,
  TripStopDTO, TripDetailsResult,
  DepartureDTO, DeparturesResult,
  RouteMode, RouteWaypoint, RouteSegment, RouteResult, RouteError, RouteResponse,
  NetworkStatusCategory, EffectDTO, ValidityDTO,
  AggregateNoticeDTO, DisruptionNoticeDTO, NetworkStatusResult,
} from '@shared/api-types';

/** UI selection for the departures panel (operating-point click or station search). */
export interface DeparturesStation {
  name: string;
  lat: number;
  lon: number;
}
