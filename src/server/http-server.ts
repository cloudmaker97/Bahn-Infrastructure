// HTTP-Server: nimmt Requests an und delegiert an ApiRouter bzw. StaticFileHandler.
// Verantwortung: HTTP-Transport + Delegation (SRP).
import { createServer, type Server } from 'node:http';
import type { ApiRouter } from './api-router.js';
import type { StaticFileHandler } from './static-file-handler.js';

export class HttpServer {
  private server: Server;
  private requests = 0;
  private _boundPort = 0;

  constructor(
    private port: number,
    private api: ApiRouter,
    private staticFiles: StaticFileHandler,
  ) {
    this.server = createServer((req, res) => {
      this.requests++;
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (this.api.handle(u.pathname, u.searchParams, res)) return;
      void this.staticFiles.serve(decodeURIComponent(u.pathname), res);
    });
  }

  /** Startet den Server; loest mit dem tatsaechlich gebundenen Port auf (bei port=0 vom OS vergeben). */
  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        const addr = this.server.address();
        this._boundPort = addr && typeof addr === 'object' ? addr.port : this.port;
        resolve(this._boundPort);
      });
    });
  }
  close(): void { this.server.close(); }
  get requestCount(): number { return this.requests; }
  /** Tatsaechlich gebundener Port (erst nach listen() gueltig). */
  get boundPort(): number { return this._boundPort; }
}
