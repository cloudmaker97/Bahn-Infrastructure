// Selftest for the StationRepository (pure, offline, fake JsonStore).
// Run with: npx tsx src/data/station-repository.selftest.ts
import assert from 'node:assert';
import { StationRepository } from './station-repository.js';
import type { JsonStore } from './json-store.js';

/** Fake JsonStore that serves betriebsstellen_meta.json from memory. */
function storeWith(rows: Record<string, unknown>[]): JsonStore {
  return { read: () => rows } as unknown as JsonStore;
}

function row(stel: number, rl100: string, name: string): Record<string, unknown> {
  return { STEL_ID: stel, BST_RL100: rl100, BST_STELLE_NAME: name, ALG_GEO_LAGE: '+9.13, 49.95' };
}

// --- suggest: exact RL100 match always comes first, despite the limit ---
{
  // 30 stations sorting before "TS" whose NAMES contain "ts" (like the real
  // data set, where e.g. "Altstadt" pushes "TS" = Stuttgart Hbf out of the limit).
  const fillers = Array.from({ length: 30 }, (_, i) =>
    row(1000 + i, `A${String(i).padStart(2, '0')}`, `Altstadt ${i}`));
  const repo = new StationRepository(storeWith([
    ...fillers,
    row(1, 'TS', 'Stuttgart Hbf'),
    row(2, 'TSA', 'Stuttgart Nord'),
  ]));

  const limited = repo.suggest('TS', 5);
  assert.strictEqual(limited[0]?.rl100, 'TS', 'exact RL100 match is first despite the limit');
  assert.strictEqual(limited.length, 5, 'limit still applies');
  assert.strictEqual(limited.filter((s) => s.rl100 === 'TS').length, 1, 'exact match not duplicated');

  const ts = repo.suggest('ts', 40);
  assert.strictEqual(ts[0]?.rl100, 'TS', 'exact match is case-insensitive');
  assert.ok(ts.some((s) => s.rl100 === 'TSA'), 'prefix matches still included');
  assert.ok(ts.some((s) => s.name === 'Altstadt 0'), 'name matches still included');

  assert.deepStrictEqual(repo.suggest(''), [], 'empty query -> no results');
  assert.deepStrictEqual(repo.suggest('   '), [], 'blank query -> no results');
}

// --- resolveStel: RL100 and direct STEL_ID ---
{
  const repo = new StationRepository(storeWith([row(7, 'FF', 'Frankfurt (Main) Hbf')]));
  assert.strictEqual(repo.resolveStel('FF'), 7, 'RL100 resolves');
  assert.strictEqual(repo.resolveStel('ff'), 7, 'RL100 resolves case-insensitively');
  assert.strictEqual(repo.resolveStel('7'), 7, 'direct STEL_ID resolves');
  assert.strictEqual(repo.resolveStel('XX'), null, 'unknown code -> null');
}

console.log('station-repository selftest: OK');
