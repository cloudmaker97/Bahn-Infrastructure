// Client-side view of the server API responses. All contract types come from
// src/shared/api-types.ts (single source for server AND web, via the @shared/*
// alias) — no local duplicates.
import type { TrainDTO } from '@shared/live-trips-core';

export type { TrainDTO };

export type {
  VersionInfo, LiveTripsResult, LatLng, StationSuggestion,
  RouteMode, RouteWaypoint, RouteSegment, RouteResult, RouteError, RouteResponse,
  NetworkStatusCategory, EffectDTO, ValidityDTO,
  AggregateNoticeDTO, DisruptionNoticeDTO, NetworkStatusResult,
} from '@shared/api-types';
