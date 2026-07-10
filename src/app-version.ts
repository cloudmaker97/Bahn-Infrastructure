// Resolves the displayed software version once at startup.
// Responsibility: version resolution (SRP). Auto-incrementing via the git commit
// count (rises with every new commit/release by itself), with clean fallbacks.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

/** Reads the base version (semver) from package.json. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Runs a git command in the project root (or null). */
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
 * Builds the version string:
 *  - container/prod: `APP_VERSION` (when set) takes precedence.
 *  - dev with git: `v<semver> · build <commitCount> · <shortHash>` (build rises automatically).
 *  - otherwise: `v<semver>`.
 */
export function resolveVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;

  const base = packageVersion();
  const count = git('rev-list --count HEAD');
  const hash = git('rev-parse --short HEAD');
  if (count && hash) return `v${base} · build ${count} · ${hash}`;
  return `v${base}`;
}
