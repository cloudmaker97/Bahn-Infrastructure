// Kapselt das Lesen von JSON-Dateien aus einem Basisverzeichnis. Verantwortung: Datei-IO (SRP).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore {
  constructor(private baseDir: string) {}

  /** Liest eine JSON-Datei; null wenn nicht vorhanden. */
  read<T>(file: string): T | null {
    const p = join(this.baseDir, file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  }

  /** Liest eine JSON-Datei; wirft, wenn nicht vorhanden. */
  require<T>(file: string): T {
    const data = this.read<T>(file);
    if (data == null) throw new Error(`Datei fehlt: ${join(this.baseDir, file)}`);
    return data;
  }
}
