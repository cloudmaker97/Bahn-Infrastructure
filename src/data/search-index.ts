// Builds and searches the full-text index over all entities (operating points,
// lines, tunnels, bridges, level crossings). Responsibility: search (SRP).
// Implements EntitySearch.
import type { JsonStore } from './json-store.js';
import type { SectionProps, EntitySearch, SearchEntry, Station } from '../types.js';

/** Describes how a search entry is built from raw data (OCP: new sources are easy to add). */
interface EntrySource {
  kind: SearchEntry['kind'];
  file: string;
  map: (r: Record<string, unknown>) => Omit<SearchEntry, 'kind' | 'data'>;
}

const SOURCES: EntrySource[] = [
  {
    kind: 'line', file: 'strecken_uebersicht.json',
    map: (r) => ({
      code: String(r['ISR_STRE_NR']), name: String(r['verlauf'] ?? ''),
      detail: `${r['anz_abschnitte']} Abschnitte · ${r['betreiber'] ?? ''}`,
    }),
  },
  {
    kind: 'tunnel', file: 'tunnel_meta.json',
    map: (r) => ({
      code: String(r['DET_STR_NR'] ?? ''), name: String(r['ALG_TUNNELNAME'] ?? ''),
      detail: `${r['ALG_TUNNELLAENGE'] ?? '?'} m · ${r['ALG_TUNNELART'] ?? ''}`,
    }),
  },
  {
    kind: 'bridge', file: 'bruecken_meta.json',
    map: (r) => ({
      code: String(r['DET_STR_NR'] ?? ''), name: String(r['ALG_BRUECKENNAME'] ?? ''),
      detail: `${r['ALG_BRUECKENLAENGE'] ?? '?'} m`,
    }),
  },
  {
    kind: 'level-crossing', file: 'bahnuebergaenge_meta.json',
    map: (r) => ({
      code: String(r['ALG_DBNETZ_STRECKE'] ?? ''), name: String(r['ALG_BAHNUEBERGANGNAME'] ?? ''),
      detail: String(r['ALG_SICHERUNGSART'] ?? ''),
    }),
  },
];

export class SearchIndex implements EntitySearch {
  readonly entries: SearchEntry[] = [];

  constructor(private rawStore: JsonStore, stations: Station[]) {
    this.addStations(stations);
    for (const src of SOURCES) this.addSource(src);
    // Fallback: when no line overview exists, derive the lines from the section meta.
    if (!this.entries.some((e) => e.kind === 'line')) this.addLinesFallback();
  }

  private addStations(stations: Station[]): void {
    for (const s of stations) {
      this.entries.push({
        kind: 'station', code: s.rl100 ?? String(s.stel), name: s.name,
        detail: s.lat != null ? `${s.lat.toFixed(4)}, ${s.lon!.toFixed(4)}` : '',
        data: s as unknown as Record<string, unknown>,
      });
    }
  }

  private addSource(src: EntrySource): void {
    const rows = this.rawStore.read<Record<string, unknown>[]>(src.file);
    if (!rows) return;
    for (const r of rows) this.entries.push({ kind: src.kind, ...src.map(r), data: r });
  }

  private addLinesFallback(): void {
    const sections = this.rawStore.read<SectionProps[]>('streckenabschnitte_meta.json') ?? [];
    const seen = new Map<number, SectionProps>();
    for (const r of sections) if (r.ISR_STRE_NR != null && !seen.has(r.ISR_STRE_NR)) seen.set(r.ISR_STRE_NR, r);
    for (const [nr, r] of seen) {
      this.entries.push({
        kind: 'line', code: String(nr), name: String(r.ISR_STRECKE_VON_BIS ?? ''),
        detail: String(r.ALG_INFRA_BETR ?? ''), data: r as Record<string, unknown>,
      });
    }
  }

  search(q: string, limit = 200, kind: SearchEntry['kind'] | null = null): SearchEntry[] {
    const query = q.trim().toUpperCase();
    if (!query) return [];
    // Rank all matches first, then sort, then limit – an early cutoff would
    // drop better matches (e.g. an exact code match) otherwise.
    const scored: { entry: SearchEntry; rank: number; idx: number }[] = [];
    let idx = 0;
    for (const e of this.entries) {
      idx++;
      if (kind && e.kind !== kind) continue;
      const rank = this.matchRank(e, query);
      if (rank >= 0) scored.push({ entry: e, rank, idx });
    }
    // Smaller rank = better match; stable index order on ties.
    scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  /** Relevance of an entry for the query. -1 = no match, otherwise 0 (best) .. 5. */
  private matchRank(e: SearchEntry, query: string): number {
    const code = e.code.toUpperCase();
    const name = e.name.toUpperCase();
    if (code === query) return 0; // exact code match (e.g. RL100 "HU" = Uelzen)
    if (name === query) return 1; // exact name match
    if (code.startsWith(query)) return 2;
    if (name.startsWith(query)) return 3;
    if (code.includes(query)) return 4;
    if (name.includes(query)) return 5;
    return -1;
  }
}
