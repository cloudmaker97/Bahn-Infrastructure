// Composition root: creates and wires all components (dependency injection).
// Log and notice strings are user-facing and intentionally German (product language).
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, WEB_OUT, DATA_WEB, NETWORK_STATUS_API, NETWORK_STATUS_WS, NETWORK_STATUS_TTL_MS } from './config.js';
import { ensureData } from './ensure-data.js';
import { scrapeAll } from './scrape.js';
import { buildMapData } from './build-map-data.js';
import { resolveVersion } from './app-version.js';
import { ReloadableIsrData } from './data/reloadable-isr-data.js';
import { NetworkStatusService } from './data/network-status/service.js';
import { LiveTripsService } from './data/live-trips-service.js';
import { RouteService } from './routing/route-service.js';
import { AlignmentResolver } from './routing/alignment-resolver.js';
import { ApiRouter } from './server/api-router.js';
import { SseHub } from './server/sse-hub.js';
import { StaticFileHandler } from './server/static-file-handler.js';
import { HttpServer } from './server/http-server.js';
import { TuiApp } from './tui/tui-app.js';
import { TuiRenderer } from './tui/tui-renderer.js';
import { InputHandler } from './tui/input-handler.js';

/** Opens a URL in the system default browser (platform-dependent). */
function openInBrowser(target: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${target}"`
    : process.platform === 'darwin' ? `open "${target}"`
    : `xdg-open "${target}"`;
  exec(cmd);
}

await ensureData();

console.log('Lade ISR-Daten und baue Routing-Graph …');
const data = new ReloadableIsrData();
{
  const s = data.stats;
  console.log(
    `Graph: ${s.nodes.toLocaleString('de-DE')} Knoten, ${s.edges.toLocaleString('de-DE')} Kanten · ` +
    `${s.rl100.toLocaleString('de-DE')} RL100 · ${s.objects.toLocaleString('de-DE')} durchsuchbare Objekte`);
}

// Wire routing + HTTP (via the stable, reload-capable proxies).
const routeService = new RouteService(data.pathfinder, data.stations);
const sseHub = new SseHub();
// Notices follow the real track alignment instead of straight lines.
const alignmentResolver = new AlignmentResolver(data.pathfinder, data.stations);
const networkStatus = new NetworkStatusService(data.stations, {
  apiBase: NETWORK_STATUS_API,
  wsUrl: NETWORK_STATUS_WS,
  ttlMs: NETWORK_STATUS_TTL_MS,
  onRefresh: () => sseHub.broadcast('streckeninfo'),
  alignment: alignmentResolver.resolve,
});
const liveTrips = new LiveTripsService();
const apiRouter = new ApiRouter({
  routes: routeService,
  suggester: data.stations,
  search: data.search,
  networkStatus,
  liveTrips,
  sse: sseHub,
  version: resolveVersion(),
});
// Frontend = static Next.js export; when missing, the APIs/TUI still work.
if (!existsSync(join(WEB_OUT, 'index.html'))) {
  console.warn('Hinweis: web/out fehlt – Frontend zuerst mit `npm run build:web` bauen.');
}
const staticFiles = new StaticFileHandler(WEB_OUT, DATA_WEB);
const httpServer = new HttpServer(PORT, apiRouter, staticFiles);
const boundPort = await httpServer.listen();     // PORT=0 -> OS-assigned free port
const url = `http://localhost:${boundPort}/`;
console.log(`Server läuft auf ${url}`);

function shutdown(): void { httpServer.close(); process.exit(0); }

// Handle container/service stop cleanly (Coolify/Docker send SIGTERM).
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Headless mode (server without the interactive TUI): explicitly via HEADLESS=1
// or automatically when no TTY is present (typical inside a container).
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true' || !process.stdin.isTTY;

/** Full data refresh: re-scrape raw data, rebuild web GeoJSON, reload IsrData. */
async function refreshData(): Promise<string> {
  await scrapeAll();
  buildMapData();
  data.reload();
  alignmentResolver.clearCache(); // graph/geometries may have changed
  networkStatus.invalidate();     // the cached GeoJSON was built on the old graph
  const s = data.stats;
  return `${s.objects.toLocaleString('de-DE')} Objekte · ${s.rl100.toLocaleString('de-DE')} RL100 · ${s.edges.toLocaleString('de-DE')} Kanten`;
}

if (HEADLESS) {
  console.log('Headless-Modus: interaktive TUI deaktiviert – nur HTTP-Server läuft.');
} else {
  const tui = new TuiApp(data.search, new TuiRenderer(data.sections), new InputHandler(), networkStatus, {
    getContext: () => ({ url, requestCount: httpServer.requestCount, totalObjects: data.totalObjects }),
    onOpenBrowser: () => openInBrowser(url),
    onRefreshData: refreshData,
    onQuit: shutdown,
  });
  tui.start();
}
