// Handles the JSON APIs (/api/route, /api/stations, /api/search, ...).
// Responsibility: API routing (SRP). Depends on abstractions (DIP).
import type { ServerResponse } from 'node:http';
import type { RouteService } from '../routing/route-service.js';
import type { NetworkStatusService } from '../data/network-status/service.js';
import type { LiveTripsService } from '../data/live-trips-service.js';
import type { SseHub } from './sse-hub.js';
import type { EntitySearch, RouteMode, StationSuggester } from '../types.js';

/** Everything the router delegates to (injected by the composition root). */
export interface ApiRouterDeps {
  routes: RouteService;
  suggester: StationSuggester;
  search: EntitySearch;
  networkStatus: NetworkStatusService;
  liveTrips: LiveTripsService;
  sse: SseHub;
  version: string;
}

export class ApiRouter {
  constructor(private deps: ApiRouterDeps) {}

  /** Tries to handle the path as an API request. true = handled. */
  handle(pathname: string, params: URLSearchParams, res: ServerResponse): boolean {
    const { routes, suggester, search, networkStatus, liveTrips, sse, version } = this.deps;
    switch (pathname) {
      case '/api/route': {
        const mode: RouteMode = params.get('mode') === 'short' ? 'short' : 'fast';
        const result = routes.route(params.get('from') ?? '', params.get('to') ?? '', mode);
        this.json(res, result.ok ? 200 : 400, result);
        return true;
      }
      case '/api/stations':
        this.json(res, 200, suggester.suggest(params.get('q') ?? ''));
        return true;
      case '/api/search':
        this.json(res, 200, search.search(params.get('q') ?? '', 100));
        return true;
      case '/api/streckeninfo':
        // Async: the response is written once the (cached) network-status data
        // is loaded. getData() never throws – errors land in the error field.
        void networkStatus.getData().then((r) => this.json(res, 200, r));
        return true;
      case '/api/streckeninfo/events':
        sse.addClient(res); // the response stays open (no json())
        return true;
      case '/api/livetrips': {
        // Async: getTrains() never throws – errors land in the error field.
        const zoom = Number(params.get('zoom') ?? '6');
        void liveTrips.getTrains(zoom).then((r) => this.json(res, 200, r));
        return true;
      }
      case '/api/version':
        this.json(res, 200, { version });
        return true;
      default:
        return false;
    }
  }

  private json(res: ServerResponse, code: number, obj: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
}
