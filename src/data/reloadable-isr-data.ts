// Holds the current IsrData instance and exposes stable, delegating views (proxies)
// onto its abstractions. Server and TUI are wired once with these proxies; reload()
// swaps the underlying data completely at runtime (hot reload after re-scrape/rebuild)
// without consumers having to be recreated.
// Responsibility: lifecycle/swap of the data components (SRP); the proxies preserve DIP.
import { IsrData } from './isr-data.js';
import type {
  Edge, EntitySearch, Pathfinder, PathResult, RouteMode, SearchEntry,
  SectionLookup, SectionProps, Station, StationLookup, StationSuggester,
} from '../types.js';

export class ReloadableIsrData {
  private current: IsrData;

  constructor() {
    this.current = new IsrData();
  }

  /** Reloads IsrData from scratch (after re-scraping/rebuilding the files). Throws when data is missing. */
  reload(): void {
    this.current = new IsrData();
  }

  /** Number of searchable objects (for the TUI status line). */
  get totalObjects(): number {
    return this.current.search.entries.length;
  }

  /** Short statistics for logging/display after loading. */
  get stats(): { nodes: number; edges: number; rl100: number; objects: number } {
    return {
      nodes: this.current.graph.nodeCount,
      edges: this.current.graph.edgeCount,
      rl100: this.current.stations.stations.length,
      objects: this.current.search.entries.length,
    };
  }

  // --- Delegating proxies (each reads the CURRENT IsrData, lazily) ---

  readonly pathfinder: Pathfinder = {
    dijkstra: (start: number, goal: number, mode: RouteMode, edgeFilter?: (e: Edge) => boolean): PathResult | null =>
      this.current.graph.dijkstra(start, goal, mode, edgeFilter),
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

  readonly sections: SectionLookup = {
    byLineNumber: (nr: number): SectionProps[] => this.current.sections.byLineNumber(nr),
    byStation: (stel: number): SectionProps[] => this.current.sections.byStation(stel),
  };
}
