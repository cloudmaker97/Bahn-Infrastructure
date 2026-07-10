// HTTP server: accepts requests and delegates to ApiRouter or StaticFileHandler.
// Responsibility: HTTP transport + delegation (SRP).
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

  /** Starts the server; resolves with the actually bound port (OS-assigned for port=0). */
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
  /** Actually bound port (valid only after listen()). */
  get boundPort(): number { return this._boundPort; }
}
