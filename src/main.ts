// Composition Root: erzeugt und verdrahtet alle Komponenten (Dependency Injection).
import { exec } from 'node:child_process';
import { PORT, PUBLIC_DIR, DATA_WEB, STRECKENINFO_API, STRECKENINFO_WS, STRECKENINFO_TTL_MS } from './config.js';
import { ensureData } from './ensure-data.js';
import { IsrData } from './data/isr-data.js';
import { StreckenInfoService } from './data/streckeninfo.js';
import { RouteService } from './routing/route-service.js';
import { ApiRouter } from './server/api-router.js';
import { SseHub } from './server/sse-hub.js';
import { StaticFileHandler } from './server/static-file-handler.js';
import { HttpServer } from './server/http-server.js';
import { TuiApp } from './tui/tui-app.js';
import { TuiRenderer } from './tui/tui-renderer.js';
import { InputHandler } from './tui/input-handler.js';

const url = `http://localhost:${PORT}/`;

await ensureData();

console.log('Lade ISR-Daten und baue Routing-Graph …');
const data = new IsrData();
console.log(
  `Graph: ${data.graph.nodeCount.toLocaleString('de-DE')} Knoten, ` +
  `${data.graph.edgeCount.toLocaleString('de-DE')} Kanten · ` +
  `${data.stations.stations.length.toLocaleString('de-DE')} RL100 · ` +
  `${data.search.entries.length.toLocaleString('de-DE')} durchsuchbare Objekte`);

// Routing + HTTP verdrahten
const routeService = new RouteService(data.graph, data.stations);
const sseHub = new SseHub();
const streckeninfo = new StreckenInfoService(data.stations, {
  apiBase: STRECKENINFO_API,
  wsUrl: STRECKENINFO_WS,
  ttlMs: STRECKENINFO_TTL_MS,
  onRefresh: () => sseHub.broadcast('streckeninfo'),
});
const apiRouter = new ApiRouter(routeService, data.stations, data.search, streckeninfo, sseHub);
const staticFiles = new StaticFileHandler(PUBLIC_DIR, DATA_WEB);
const httpServer = new HttpServer(PORT, apiRouter, staticFiles);
httpServer.listen();

function shutdown(): void { httpServer.close(); process.exit(0); }

const tui = new TuiApp(data.search, new TuiRenderer(data.abschnitte), new InputHandler(), streckeninfo, {
  getContext: () => ({ url, requestCount: httpServer.requestCount, totalObjects: data.search.entries.length }),
  onQuit: shutdown,
});
tui.start();