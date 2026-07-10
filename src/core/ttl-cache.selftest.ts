// Selftest for TtlCache and SingleFlight (pure, offline, injectable clock).
// Run with: npx tsx src/core/ttl-cache.selftest.ts
import assert from 'node:assert';
import { TtlCache, SingleFlight } from './ttl-cache.js';

// --- TtlCache: fresh hit, expiry, getStale, clear ---
{
  let now = 1_000;
  const cache = new TtlCache<string, number>(100, () => now);

  assert.strictEqual(cache.get('a'), undefined, 'miss on empty cache');
  cache.set('a', 42);
  assert.strictEqual(cache.get('a'), 42, 'fresh hit');

  now += 99;
  assert.strictEqual(cache.get('a'), 42, 'still fresh at ttl-1');
  now += 2;
  assert.strictEqual(cache.get('a'), undefined, 'expired after ttl');
  assert.strictEqual(cache.getStale('a'), 42, 'getStale ignores the ttl');

  cache.set('a', 43);
  assert.strictEqual(cache.get('a'), 43, 're-set restarts the ttl');

  cache.clear();
  assert.strictEqual(cache.get('a'), undefined, 'clear removes fresh entries');
  assert.strictEqual(cache.getStale('a'), undefined, 'clear removes stale entries');
}

// --- TtlCache: independent keys ---
{
  let now = 0;
  const cache = new TtlCache<number, string>(50, () => now);
  cache.set(1, 'one');
  now += 30;
  cache.set(2, 'two');
  now += 30; // key 1 now 60ms old (expired), key 2 is 30ms old (fresh)
  assert.strictEqual(cache.get(1), undefined, 'key 1 expired');
  assert.strictEqual(cache.get(2), 'two', 'key 2 still fresh');
}

// --- SingleFlight: concurrent calls share one execution per key ---
{
  const flight = new SingleFlight<string, number>();
  let calls = 0;
  let release: (v: number) => void = () => {};
  const fn = () => {
    calls++;
    return new Promise<number>((resolve) => { release = resolve; });
  };

  const p1 = flight.run('k', fn);
  const p2 = flight.run('k', fn);
  assert.strictEqual(calls, 1, 'second call joins the in-flight promise');

  release(7);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(r1, 7);
  assert.strictEqual(r2, 7);

  // After settling, the next run starts a fresh execution.
  const p3 = flight.run('k', () => { calls++; return Promise.resolve(9); });
  assert.strictEqual(await p3, 9);
  assert.strictEqual(calls, 2, 'new execution after the previous one settled');
}

// --- SingleFlight: distinct keys run independently; rejections release the slot ---
{
  const flight = new SingleFlight<number, string>();
  const pA = flight.run(1, () => Promise.resolve('a'));
  const pB = flight.run(2, () => Promise.resolve('b'));
  assert.strictEqual(await pA, 'a');
  assert.strictEqual(await pB, 'b');

  await assert.rejects(
    flight.run(1, () => Promise.reject(new Error('boom'))),
    /boom/,
    'rejection propagates',
  );
  // The failed slot is released – the next run executes again.
  assert.strictEqual(await flight.run(1, () => Promise.resolve('c')), 'c', 'slot released after rejection');
}

console.log('SELFTEST OK');
