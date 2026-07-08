// Verwaltet Betriebsstellen: Nachschlagen (RL100/STEL), Autocomplete.
// Verantwortung: Betriebsstellen-Repository (SRP). Implementiert StationLookup + StationSuggester.
import { parseLage } from '../core/geo.js';
import type { JsonStore } from './json-store.js';
import type { Station, StationLookup, StationSuggester } from '../types.js';

export class StationRepository implements StationLookup, StationSuggester {
  private nodeInfo = new Map<number, Station>();
  private rl2stel = new Map<string, number>();
  readonly stations: Station[] = [];

  constructor(rawStore: JsonStore) {
    const rows = rawStore.read<Record<string, unknown>[]>('betriebsstellen_meta.json') ?? [];
    for (const r of rows) {
      const stel = r['STEL_ID'] as number | undefined;
      if (stel == null || this.nodeInfo.has(stel)) continue; // Duplikate je STEL_ID ueberspringen
      const lage = parseLage(r['ALG_GEO_LAGE']);
      const station: Station = {
        stel,
        rl100: (r['BST_RL100'] as string) || null,
        name: (r['BST_STELLE_NAME'] as string) || (r['BST_BESCHREIBUNG'] as string) || '',
        lat: lage?.lat ?? null,
        lon: lage?.lon ?? null,
      };
      this.nodeInfo.set(stel, station);
      if (station.rl100) {
        const key = station.rl100.toUpperCase();
        if (!this.rl2stel.has(key)) this.rl2stel.set(key, stel);
        this.stations.push(station);
      }
    }
    this.stations.sort((a, b) => (a.rl100 ?? '').localeCompare(b.rl100 ?? ''));
  }

  getStation(stel: number): Station | undefined {
    return this.nodeInfo.get(stel);
  }

  /** RL100 oder direkte STEL_ID -> stel. */
  resolveStel(code: string | undefined): number | null {
    if (!code) return null;
    const c = code.trim();
    const byRl = this.rl2stel.get(c.toUpperCase());
    if (byRl != null) return byRl;
    const asNum = Number(c);
    if (Number.isInteger(asNum) && this.nodeInfo.has(asNum)) return asNum;
    return null;
  }

  suggest(q: string, limit = 25): Station[] {
    const query = q.trim().toUpperCase();
    if (!query) return [];
    const out: Station[] = [];
    for (const s of this.stations) {
      if ((s.rl100 ?? '').toUpperCase().startsWith(query) || s.name.toUpperCase().includes(query)) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}
