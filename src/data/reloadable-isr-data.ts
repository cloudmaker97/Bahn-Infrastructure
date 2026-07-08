// Haelt die aktuelle IsrData-Instanz und stellt stabile, delegierende Sichten (Proxies)
// auf deren Abstraktionen bereit. Server und TUI werden einmalig mit diesen Proxies
// verdrahtet; ein reload() tauscht die zugrunde liegenden Daten im Betrieb komplett aus
// (Hot-Reload nach Re-Scrape/Rebuild), ohne dass Konsumenten neu erzeugt werden muessen.
// Verantwortung: Lebenszyklus/Austausch der Datenkomponenten (SRP); die Proxies wahren DIP.
import { IsrData } from './isr-data.js';
import type {
  AbschnittLookup, AbschnittProps, EntitySearch, Pathfinder, PathResult,
  RouteMode, SearchEntry, Station, StationLookup, StationSuggester,
} from '../types.js';

export class ReloadableIsrData {
  private current: IsrData;

  constructor() {
    this.current = new IsrData();
  }

  /** Laedt IsrData komplett neu (nach Re-Scrape/Rebuild der Dateien). Wirft bei fehlenden Daten. */
  reload(): void {
    this.current = new IsrData();
  }

  /** Anzahl durchsuchbarer Objekte (fuer die TUI-Statuszeile). */
  get totalObjects(): number {
    return this.current.search.entries.length;
  }

  /** Kurzstatistik fuer Log/Anzeige nach dem Laden. */
  get stats(): { nodes: number; edges: number; rl100: number; objects: number } {
    return {
      nodes: this.current.graph.nodeCount,
      edges: this.current.graph.edgeCount,
      rl100: this.current.stations.stations.length,
      objects: this.current.search.entries.length,
    };
  }

  // --- Delegierende Proxies (lesen jeweils die AKTUELLE IsrData, lazy) ---

  readonly pathfinder: Pathfinder = {
    dijkstra: (start: number, goal: number, mode: RouteMode): PathResult | null =>
      this.current.graph.dijkstra(start, goal, mode),
  };

  readonly stations: StationLookup & StationSuggester = {
    resolveStel: (code: string | undefined): number | null => this.current.stations.resolveStel(code),
    getStation: (stel: number): Station | undefined => this.current.stations.getStation(stel),
    suggest: (q: string, limit?: number): Station[] => this.current.stations.suggest(q, limit),
  };

  readonly search: EntitySearch = {
    search: (q: string, limit?: number, kind?: SearchEntry['kind'] | null): SearchEntry[] =>
      this.current.search.search(q, limit, kind),
  };

  readonly abschnitte: AbschnittLookup = {
    byStrecke: (nr: number): AbschnittProps[] => this.current.abschnitte.byStrecke(nr),
  };
}
