// Liefert statische Dateien aus public/ (und data/web/ unter /data/). Verantwortung: Static-IO (SRP).
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export class StaticFileHandler {
  constructor(private publicDir: string, private webDir: string) {}

  async serve(pathname: string, res: ServerResponse): Promise<void> {
    let base = this.publicDir, rel = pathname;
    if (pathname.startsWith('/data/')) { base = this.webDir; rel = pathname.slice('/data/'.length); }
    else if (pathname === '/') rel = 'index.html';

    const file = join(base, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end('Not found: ' + pathname);
    }
  }
}
