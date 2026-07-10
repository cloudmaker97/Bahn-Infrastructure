// Manages server-sent-events clients and broadcasts refresh signals.
// Responsibility: SSE connection management (SRP). Knows no domain content.
import type { ServerResponse } from 'node:http';

export class SseHub {
  private clients = new Set<ServerResponse>();

  /** Registers an open response as an SSE stream. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 5000\n\n'); // reconnect hint for EventSource
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
    res.on('error', () => {
      this.clients.delete(res);
    });
  }

  /** Sends a (data-less) event to all clients; dead clients are removed. */
  broadcast(event: string): void {
    const frame = `event: ${event}\ndata: {}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(frame);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
