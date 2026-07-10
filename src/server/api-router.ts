// Bearbeitet die JSON-APIs (/api/route, /api/stations, /api/search).
// Verantwortung: API-Routing (SRP). Haengt von Abstraktionen ab (DIP).
import type { ServerResponse } from 'node:http';
import type { RouteService } from '../routing/route-service.js';
import type { NetworkStatusService } from '../data/network-status/service.js';
import type { LiveTripsService } from '../data/live-trips-service.js';
import type { SseHub } from './sse-hub.js';
import type { EntitySearch, RouteMode, StationSuggester } from '../types.js';

export class ApiRouter {
  constructor(
    private routes: RouteService,
    private suggester: StationSuggester,
    private search: EntitySearch,
    private networkStatus: NetworkStatusService,
    private liveTrips: LiveTripsService,
    private sse: SseHub,
    private version: string,
  ) {}

  /** Versucht, den Pfad als API zu behandeln. true = erledigt. */
  handle(pathname: string, params: URLSearchParams, res: ServerResponse): boolean {
    switch (pathname) {
      case '/api/route': {
        const mode: RouteMode = params.get('mode') === 'short' ? 'short' : 'fast';
        const result = this.routes.route(params.get('from') ?? '', params.get('to') ?? '', mode);
        this.json(res, result.ok ? 200 : 400, result);
        return true;
      }
      case '/api/stations':
        this.json(res, 200, this.suggester.suggest(params.get('q') ?? ''));
        return true;
      case '/api/search':
        this.json(res, 200, this.search.search(params.get('q') ?? '', 100));
        return true;
      case '/api/streckeninfo':
        // Asynchron: Antwort wird geschrieben, sobald die (gecachten) strecken-info-
        // Daten geladen sind. getData() wirft nie – Fehler stehen im error-Feld.
        void this.networkStatus.getData().then((r) => this.json(res, 200, r));
        return true;
      case '/api/streckeninfo/events':
        this.sse.addClient(res); // Response bleibt offen (kein json())
        return true;
      case '/api/livetrips': {
        // Asynchron: getTrains() wirft nie – Fehler stehen im error-Feld.
        const zoom = Number(params.get('zoom') ?? '6');
        void this.liveTrips.getTrains(zoom).then((r) => this.json(res, 200, r));
        return true;
      }
      case '/api/version':
        this.json(res, 200, { version: this.version });
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
