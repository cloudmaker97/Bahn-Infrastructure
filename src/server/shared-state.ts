// Shared state singleton: ensures a single source of truth for in-memory graph
// and active services across both Next.js hot-reloads and HTTP routing.
// Adheres to SOLID (Single Responsibility, Dependency Injection) principles.
import { ReloadableIsrData } from '../data/reloadable-isr-data.js';
import { RouteService } from '../routing/route-service.js';
import { StreckenInfoService } from '../data/streckeninfo.js';
import { TripsService } from '../data/trips-service.js';
import { SseHub } from './sse-hub.js';
import { resolveVersion } from '../app-version.js';
import { STRECKENINFO_API, STRECKENINFO_WS } from '../config.js';

interface GlobalState {
  data?: ReloadableIsrData;
  routeService?: RouteService;
  tripsService?: TripsService;
  sseHub?: SseHub;
  streckeninfo?: StreckenInfoService;
  version?: string;
  isInitialized?: boolean;
}

const g = global as unknown as GlobalState;

/** Initializes the shared service singletons if not already initialized. */
export async function ensureInitialized(): Promise<void> {
  if (g.isInitialized) return;

  const data = new ReloadableIsrData();
  const routeService = new RouteService(data.pathfinder, data.stations);
  const tripsService = new TripsService();
  const sseHub = new SseHub();
  
  // 10s Caching Burst for Meldungen is enforced via StreckenInfoService ttlMs = 10000
  const streckeninfo = new StreckenInfoService(data.stations, {
    apiBase: STRECKENINFO_API,
    wsUrl: STRECKENINFO_WS,
    ttlMs: 10_000, 
    onRefresh: () => sseHub.broadcast('streckeninfo'),
  });

  g.data = data;
  g.routeService = routeService;
  g.tripsService = tripsService;
  g.sseHub = sseHub;
  g.streckeninfo = streckeninfo;
  g.version = resolveVersion();
  g.isInitialized = true;
}

/** Retrieves the shared services instances. Throws if uninitialized. */
export function getSharedState() {
  if (!g.isInitialized) {
    throw new Error('Shared state has not been initialized. Call ensureInitialized() first.');
  }
  return {
    data: g.data!,
    routeService: g.routeService!,
    tripsService: g.tripsService!,
    sseHub: g.sseHub!,
    streckeninfo: g.streckeninfo!,
    version: g.version!,
  };
}
