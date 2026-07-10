// Small caching primitives shared by the upstream services (network status,
// live trips): a TTL cache with last-known-good access and a single-flight
// helper that lets concurrent callers share one in-flight promise per key.
// The clock is injectable so expiry is testable without real waiting.

export class TtlCache<K, V> {
  private entries = new Map<K, { value: V; ts: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Fresh value only; undefined when missing or older than the TTL. */
  get(key: K): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    return this.now() - hit.ts < this.ttlMs ? hit.value : undefined;
  }

  /** Last stored value regardless of age (last-known-good fallback on errors). */
  getStale(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  /** Stores a value and (re)starts its TTL. */
  set(key: K, value: V): void {
    this.entries.set(key, { value, ts: this.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}

export class SingleFlight<K, V> {
  private inflight = new Map<K, Promise<V>>();

  /**
   * Runs `fn` unless a call for `key` is already in flight – then the running
   * promise is shared. The slot is released once the promise settles (also on
   * rejection), so the next call executes again.
   */
  run(key: K, fn: () => Promise<V>): Promise<V> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
