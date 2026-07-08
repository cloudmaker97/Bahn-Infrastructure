// HTTP-Server: nimmt Requests an und delegiert an ApiRouter bzw. StaticFileHandler.
// Verantwortung: HTTP-Transport + Delegation (SRP).
import { createServer, type Server } from 'node:http';
import type { ApiRouter } from './api-router.js';
import type { StaticFileHandler } from './static-file-handler.js';

export class HttpServer {
  private server: Server;
  private requests = 0;

  constructor(
    private port: number,
    private api: ApiRouter,
    private staticFiles: StaticFileHandler,
  ) {
    this.server = createServer((req, res) => {
      this.requests++;
      const u = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      if (this.api.handle(u.pathname, u.searchParams, res)) return;
      void this.staticFiles.serve(decodeURIComponent(u.pathname), res);
    });
  }

  listen(): void { this.server.listen(this.port); }
  close(): void { this.server.close(); }
  get requestCount(): number { return this.requests; }
}
