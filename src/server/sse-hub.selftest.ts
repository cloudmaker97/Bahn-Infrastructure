// Selbsttest fuer den SseHub. Laufbar mit: npx tsx src/server/sse-hub.selftest.ts
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { SseHub } from './sse-hub.js';

/** Minimales ServerResponse-Double: sammelt geschriebene Frames, feuert 'close'. */
class FakeRes extends EventEmitter {
  head: { code: number; headers: Record<string, string> } | null = null;
  chunks: string[] = [];
  writeHead(code: number, headers: Record<string, string>): this {
    this.head = { code, headers };
    return this;
  }
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
}

{
  const hub = new SseHub();
  const a = new FakeRes();
  const b = new FakeRes();

  hub.addClient(a as unknown as ServerResponse);
  hub.addClient(b as unknown as ServerResponse);
  assert.strictEqual(hub.clientCount, 2, 'zwei Clients registriert');
  assert.strictEqual(a.head?.code, 200, 'SSE-Header 200');
  assert.match(a.head?.headers['Content-Type'] ?? '', /text\/event-stream/, 'event-stream MIME');

  hub.broadcast('streckeninfo');
  assert.ok(
    a.chunks.some((c) => c.includes('event: streckeninfo\ndata: {}\n\n')),
    'Client a hat Event erhalten',
  );
  assert.ok(b.chunks.some((c) => c.includes('event: streckeninfo')), 'Client b hat Event erhalten');

  a.emit('close');
  assert.strictEqual(hub.clientCount, 1, 'Client a nach close entfernt');

  hub.broadcast('streckeninfo'); // darf nicht werfen, obwohl a geschlossen ist
  console.log('SseHub OK');
}

{
  // Deckt den catch-Zweig in broadcast() ab: ein Client, dessen write() wirft,
  // wird entfernt, ohne dass die Exception nach aussen dringt.
  const hub = new SseHub();

  /**
   * ServerResponse-Double, dessen write() erst ab dem zweiten Aufruf wirft.
   * Der erste Aufruf ist der retry-Hinweis aus addClient() und muss gelingen,
   * damit der Client ueberhaupt registriert wird; der zweite Aufruf (aus
   * broadcast()) simuliert einen kaputten Socket.
   */
  class ThrowingRes extends EventEmitter {
    private writes = 0;
    writeHead(): this {
      return this;
    }
    write(): boolean {
      this.writes += 1;
      if (this.writes > 1) {
        throw new Error('socket kaputt');
      }
      return true;
    }
  }

  const good = new FakeRes();
  const bad = new ThrowingRes();

  hub.addClient(good as unknown as ServerResponse);
  hub.addClient(bad as unknown as ServerResponse);
  assert.strictEqual(hub.clientCount, 2, 'zwei Clients vor dem Schreibfehler registriert');

  assert.doesNotThrow(() => hub.broadcast('streckeninfo'), 'broadcast wirft nicht bei defektem Client');
  assert.strictEqual(hub.clientCount, 1, 'Client mit Schreibfehler wurde entfernt');
  assert.ok(
    good.chunks.includes('event: streckeninfo\ndata: {}\n\n'),
    'intakter Client hat vollstaendigen Frame erhalten',
  );

  console.log('SseHub broadcast-Schreibfehler OK');
}
