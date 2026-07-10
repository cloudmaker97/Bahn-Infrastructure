// Facade that assembles the data components (SRP per component, DIP outward).
// Server and TUI obtain the abstractions they need from here.
import { JsonStore } from './json-store.js';
import { GraphBuilder } from './graph-builder.js';
import { StationRepository } from './station-repository.js';
import { SearchIndex } from './search-index.js';
import { SectionRepository } from './section-repository.js';
import { DATA_RAW, DATA_WEB } from '../config.js';
import type { Graph } from '../core/graph.js';

export class IsrData {
  readonly graph: Graph;
  readonly stations: StationRepository;
  readonly search: SearchIndex;
  readonly sections: SectionRepository;

  constructor(rawDir = DATA_RAW, webDir = DATA_WEB) {
    const rawStore = new JsonStore(rawDir);
    const webStore = new JsonStore(webDir);
    this.graph = new GraphBuilder(webStore).build();
    this.stations = new StationRepository(rawStore);
    this.search = new SearchIndex(rawStore, this.stations.stations);
    this.sections = new SectionRepository(rawStore);
  }
}
