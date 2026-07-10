// Composition Root: erzeugt und verdrahtet alle Komponenten (Dependency Injection).
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, WEB_OUT, DATA_WEB, STRECKENINFO_API, STRECKENINFO_WS, STRECKENINFO_TTL_MS } from './config.js';
import { ensureData } from './ensure-data.js';
import { scrapeAll } from './scrape.js';
import { buildMapData } from './build-map-data.js';
import { resolveVersion } from './app-version.js';
import { ReloadableIsrData } from './data/reloadable-isr-data.js';
import { StreckenInfoService } from './data/streckeninfo.js';
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

/** Oeffnet eine URL im System-Standardbrowser (plattformabhaengig). */
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

// Routing + HTTP verdrahten (ueber die stabilen, reload-faehigen Proxies)
const routeService = new RouteService(data.pathfinder, data.stations);
const sseHub = new SseHub();
// Meldungen folgen dem realen Streckenverlauf statt der Luftlinie.
const alignmentResolver = new AlignmentResolver(data.pathfinder, data.stations);
const streckeninfo = new StreckenInfoService(data.stations, {
  apiBase: STRECKENINFO_API,
  wsUrl: STRECKENINFO_WS,
  ttlMs: STRECKENINFO_TTL_MS,
  onRefresh: () => sseHub.broadcast('streckeninfo'),
  alignment: alignmentResolver.resolve,
});
const liveTrips = new LiveTripsService();
const apiRouter = new ApiRouter(routeService, data.stations, data.search, streckeninfo, liveTrips, sseHub, resolveVersion());
// Frontend = statischer Next.js-Export; fehlt er, laufen APIs/TUI trotzdem.
if (!existsSync(join(WEB_OUT, 'index.html'))) {
  console.warn('Hinweis: web/out fehlt – Frontend zuerst mit `npm run build:web` bauen.');
}
const staticFiles = new StaticFileHandler(WEB_OUT, DATA_WEB);
const httpServer = new HttpServer(PORT, apiRouter, staticFiles);
const boundPort = await httpServer.listen();     // PORT=0 -> vom OS vergebener freier Port
const url = `http://localhost:${boundPort}/`;
console.log(`Server läuft auf ${url}`);

function shutdown(): void { httpServer.close(); process.exit(0); }

// Container/Dienst-Stopp (Coolify/Docker senden SIGTERM) sauber behandeln.
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Headless-Modus (Server ohne interaktive TUI): explizit via HEADLESS=1 oder
// automatisch, wenn kein TTY vorhanden ist (typisch im Container).
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true' || !process.stdin.isTTY;

/** Vollstaendiger Daten-Refresh: Rohdaten neu scrapen, Web-GeoJSON neu bauen, IsrData neu laden. */
async function refreshData(): Promise<string> {
  await scrapeAll();
  buildMapData();
  data.reload();
  alignmentResolver.clearCache(); // Graph/Geometrien koennten sich geaendert haben
  streckeninfo.invalidate();    // gecachtes GeoJSON basiert noch auf dem alten Graphen
  const s = data.stats;
  return `${s.objects.toLocaleString('de-DE')} Objekte · ${s.rl100.toLocaleString('de-DE')} RL100 · ${s.edges.toLocaleString('de-DE')} Kanten`;
}

if (HEADLESS) {
  console.log('Headless-Modus: interaktive TUI deaktiviert – nur HTTP-Server läuft.');
} else {
  const tui = new TuiApp(data.search, new TuiRenderer(data.sections), new InputHandler(), streckeninfo, {
    getContext: () => ({ url, requestCount: httpServer.requestCount, totalObjects: data.totalObjects }),
    onOpenBrowser: () => openInBrowser(url),
    onRefreshData: refreshData,
    onQuit: shutdown,
  });
  tui.start();
}
