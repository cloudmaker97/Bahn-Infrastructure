// Baut und durchsucht den Volltext-Index ueber alle Entitaeten (Betriebsstellen,
// Strecken, Tunnel, Bruecken, Bahnuebergaenge). Verantwortung: Suche (SRP).
// Implementiert EntitySearch.
import type { JsonStore } from './json-store.js';
import type { SectionProps, EntitySearch, SearchEntry, Station } from '../types.js';

/** Beschreibt, wie aus Rohdaten ein Sucheintrag entsteht (OCP: neue Quellen leicht ergaenzbar). */
interface EntrySource {
  kind: SearchEntry['kind'];
  file: string;
  map: (r: Record<string, unknown>) => Omit<SearchEntry, 'kind' | 'data'>;
}

const SOURCES: EntrySource[] = [
  {
    kind: 'Strecke', file: 'strecken_uebersicht.json',
    map: (r) => ({
      code: String(r['ISR_STRE_NR']), name: String(r['verlauf'] ?? ''),
      detail: `${r['anz_abschnitte']} Abschnitte · ${r['betreiber'] ?? ''}`,
    }),
  },
  {
    kind: 'Tunnel', file: 'tunnel_meta.json',
    map: (r) => ({
      code: String(r['DET_STR_NR'] ?? ''), name: String(r['ALG_TUNNELNAME'] ?? ''),
      detail: `${r['ALG_TUNNELLAENGE'] ?? '?'} m · ${r['ALG_TUNNELART'] ?? ''}`,
    }),
  },
  {
    kind: 'Brücke', file: 'bruecken_meta.json',
    map: (r) => ({
      code: String(r['DET_STR_NR'] ?? ''), name: String(r['ALG_BRUECKENNAME'] ?? ''),
      detail: `${r['ALG_BRUECKENLAENGE'] ?? '?'} m`,
    }),
  },
  {
    kind: 'Bahnübergang', file: 'bahnuebergaenge_meta.json',
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
    // Fallback: falls keine Strecken-Uebersicht vorhanden, aus Abschnitts-Meta ableiten
    if (!this.entries.some((e) => e.kind === 'Strecke')) this.addStreckenFallback();
  }

  private addStations(stations: Station[]): void {
    for (const s of stations) {
      this.entries.push({
        kind: 'Betriebsstelle', code: s.rl100 ?? String(s.stel), name: s.name,
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

  private addStreckenFallback(): void {
    const ab = this.rawStore.read<SectionProps[]>('streckenabschnitte_meta.json') ?? [];
    const seen = new Map<number, SectionProps>();
    for (const r of ab) if (r.ISR_STRE_NR != null && !seen.has(r.ISR_STRE_NR)) seen.set(r.ISR_STRE_NR, r);
    for (const [nr, r] of seen) {
      this.entries.push({
        kind: 'Strecke', code: String(nr), name: String(r.ISR_STRECKE_VON_BIS ?? ''),
        detail: String(r.ALG_INFRA_BETR ?? ''), data: r as Record<string, unknown>,
      });
    }
  }

  search(q: string, limit = 200, kind: SearchEntry['kind'] | null = null): SearchEntry[] {
    const query = q.trim().toUpperCase();
    if (!query) return [];
    // Erst alle Treffer bewerten, dann sortieren, dann limitieren – sonst wuerde
    // ein frueher Abbruch bessere Treffer (z. B. exakter Code-Match) abschneiden.
    const scored: { entry: SearchEntry; rank: number; idx: number }[] = [];
    let idx = 0;
    for (const e of this.entries) {
      idx++;
      if (kind && e.kind !== kind) continue;
      const rank = this.matchRank(e, query);
      if (rank >= 0) scored.push({ entry: e, rank, idx });
    }
    // Kleinerer rank = besserer Treffer; bei Gleichstand stabile Index-Reihenfolge.
    scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  /** Relevanz eines Eintrags fuer die Query. -1 = kein Treffer, sonst 0 (beste) .. 5. */
  private matchRank(e: SearchEntry, query: string): number {
    const code = e.code.toUpperCase();
    const name = e.name.toUpperCase();
    if (code === query) return 0; // exakter Code-Treffer (z. B. RL100 "HU" = Uelzen)
    if (name === query) return 1; // exakter Namenstreffer
    if (code.startsWith(query)) return 2;
    if (name.startsWith(query)) return 3;
    if (code.includes(query)) return 4;
    if (name.includes(query)) return 5;
    return -1;
  }
}
