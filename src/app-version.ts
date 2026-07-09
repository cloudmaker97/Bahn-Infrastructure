// Ermittelt die anzuzeigende Software-Version einmalig beim Start.
// Verantwortung: Versionsauflösung (SRP). Auto-inkrementierend über die Git-Commit-
// Anzahl (steigt bei jedem neuen Commit/Release von selbst), mit sauberen Fallbacks.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

/** Liest die Basis-Version (semver) aus der package.json. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Führt ein Git-Kommando im Projektwurzel-Verzeichnis aus (oder null). */
function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Baut die Versionszeichenkette:
 *  - Container/Prod: `APP_VERSION` (falls gesetzt) hat Vorrang.
 *  - Dev mit Git: `v<semver> · build <commitAnzahl> · <kurzHash>` (build steigt automatisch).
 *  - sonst: `v<semver>`.
 */
export function resolveVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;

  const base = packageVersion();
  const count = git('rev-list --count HEAD');
  const hash = git('rev-parse --short HEAD');
  if (count && hash) return `v${base} · build ${count} · ${hash}`;
  return `v${base}`;
}
