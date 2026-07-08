// Verwaltet Server-Sent-Events-Clients und broadcastet Refresh-Signale.
// Verantwortung: SSE-Verbindungsverwaltung (SRP). Kennt keine Fachinhalte.
import type { ServerResponse } from 'node:http';

export class SseHub {
  private clients = new Set<ServerResponse>();

  /** Registriert eine offene Response als SSE-Stream. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 5000\n\n'); // Reconnect-Hinweis fuer EventSource
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /** Sendet ein (datenloses) Event an alle Clients; tote Clients werden entfernt. */
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
