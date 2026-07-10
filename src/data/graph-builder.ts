// Baut aus der Web-GeoJSON der Streckenabschnitte den Routing-Graphen.
// Verantwortung: Graphaufbau (SRP). Haengt von Abstraktionen (JsonStore) ab.
import { Graph } from '../core/graph.js';
import { parseGermanNumber, polylineLengthKm, stitchSegments } from '../core/geometry.js';
import { DEFAULT_SPEED } from '../config.js';
import type { JsonStore } from './json-store.js';
import type { SectionProps, FeatureCollection, LatLng } from '../types.js';

export class GraphBuilder {
  constructor(private webStore: JsonStore) {}

  build(): Graph {
    const geo = this.webStore.read<FeatureCollection<SectionProps>>('map_streckenabschnitte.geojson');
    if (!geo) throw new Error('map_streckenabschnitte.geojson fehlt – erst `npm run build:data` ausfuehren.');
    const graph = new Graph();
    for (const f of geo.features) {
      const p = f.properties;
      const a = p.ISR_STEL_ID_VON, b = p.ISR_STEL_ID_BIS;
      if (a == null || b == null) continue;

      // The section geometry is a MultiLineString: its segments come in arbitrary
      // order/orientation and are stitched into ONE gapless chain – otherwise
      // large jumps appear (see stitchSegments).
      const pieces: LatLng[][] = [];
      if (f.geometry && Array.isArray(f.geometry.coordinates)) {
        for (const line of f.geometry.coordinates as number[][][]) {
          pieces.push((line as number[][]).map(([lon, lat]) => [lat!, lon!] as LatLng));
        }
      }
      const coords = stitchSegments(pieces);
      let dist = parseGermanNumber(p.ALG_LAENGE_ABSCHNITT);
      if (!isFinite(dist) || dist <= 0) dist = coords.length > 1 ? polylineLengthKm(coords) : 0.1;
      let speed = parseGermanNumber(p.BET_GESCHWINDIGKEIT);
      if (!isFinite(speed) || speed <= 0) speed = DEFAULT_SPEED;

      graph.addBidirectional(a, b, {
        timeMin: (dist / speed) * 60,
        distKm: dist,
        lineNumber: p.ISR_STRE_NR,
        coords,
      });
    }
    return graph;
  }
}
