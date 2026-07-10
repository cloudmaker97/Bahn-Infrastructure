// Encapsulates reading JSON files from a base directory. Responsibility: file IO (SRP).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore {
  constructor(private baseDir: string) {}

  /** Reads a JSON file; null when missing. */
  read<T>(file: string): T | null {
    const p = join(this.baseDir, file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  }

  /** Reads a JSON file; throws when missing. */
  require<T>(file: string): T {
    const data = this.read<T>(file);
    if (data == null) throw new Error(`Datei fehlt: ${join(this.baseDir, file)}`);
    return data;
  }
}
