// Selftest for the SseHub. Run with: npx tsx src/server/sse-hub.selftest.ts
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { SseHub } from './sse-hub.js';

/** Minimal ServerResponse double: collects written frames, fires 'close'. */
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
  assert.strictEqual(hub.clientCount, 2, 'two clients registered');
  assert.strictEqual(a.head?.code, 200, 'SSE header 200');
  assert.match(a.head?.headers['Content-Type'] ?? '', /text\/event-stream/, 'event-stream MIME');

  hub.broadcast('streckeninfo');
  assert.ok(
    a.chunks.some((c) => c.includes('event: streckeninfo\ndata: {}\n\n')),
    'client a received the event',
  );
  assert.ok(b.chunks.some((c) => c.includes('event: streckeninfo')), 'client b received the event');

  a.emit('close');
  assert.strictEqual(hub.clientCount, 1, 'client a removed after close');

  hub.broadcast('streckeninfo'); // must not throw although a is closed
  console.log('SseHub OK');
}

{
  // Covers the catch branch in broadcast(): a client whose write() throws is
  // removed without the exception escaping.
  const hub = new SseHub();

  /**
   * ServerResponse double whose write() throws from the second call on.
   * The first call is the retry hint from addClient() and must succeed so the
   * client gets registered at all; the second call (from broadcast()) simulates
   * a broken socket.
   */
  class ThrowingRes extends EventEmitter {
    private writes = 0;
    writeHead(): this {
      return this;
    }
    write(): boolean {
      this.writes += 1;
      if (this.writes > 1) {
        throw new Error('broken socket');
      }
      return true;
    }
  }

  const good = new FakeRes();
  const bad = new ThrowingRes();

  hub.addClient(good as unknown as ServerResponse);
  hub.addClient(bad as unknown as ServerResponse);
  assert.strictEqual(hub.clientCount, 2, 'two clients registered before the write error');

  assert.doesNotThrow(() => hub.broadcast('streckeninfo'), 'broadcast does not throw on a broken client');
  assert.strictEqual(hub.clientCount, 1, 'client with the write error was removed');
  assert.ok(
    good.chunks.includes('event: streckeninfo\ndata: {}\n\n'),
    'intact client received the complete frame',
  );

  console.log('SseHub broadcast write-error OK');
}
