// Computes routes between two operating points. Responsibility: routing (SRP).
// Depends only on abstractions (Pathfinder, StationLookup) -> DIP, easy to test.
// Error strings are user-facing and intentionally German (product language).
import type {
  Pathfinder, StationLookup, RouteMode, RouteResult, RouteError, RouteWaypoint,
} from '../types.js';

export class RouteService {
  constructor(private pathfinder: Pathfinder, private stations: StationLookup) {}

  route(fromCode: string, toCode: string, mode: RouteMode): RouteResult | RouteError {
    const from = this.stations.resolveStel(fromCode);
    const to = this.stations.resolveStel(toCode);
    if (from == null) return { ok: false, error: `Start nicht gefunden: ${fromCode}` };
    if (to == null) return { ok: false, error: `Ziel nicht gefunden: ${toCode}` };
    if (from === to) return { ok: false, error: 'Start und Ziel sind identisch' };

    const path = this.pathfinder.dijkstra(from, to, mode);
    if (!path) return { ok: false, error: 'Keine Route gefunden (Netz evtl. nicht verbunden)' };

    let totalTime = 0, totalDist = 0;
    const segments = path.edges.map((e) => {
      totalTime += e.timeMin; totalDist += e.distKm;
      return { line: e.lineNumber, timeMin: +e.timeMin.toFixed(2), distKm: +e.distKm.toFixed(3), coords: e.coords };
    });
    const waypoints: RouteWaypoint[] = path.nodesSeq.map((s) => {
      const info = this.stations.getStation(s);
      return { stel: s, rl100: info?.rl100 ?? null, name: info?.name ?? null, lat: info?.lat ?? null, lon: info?.lon ?? null };
    });
    return {
      ok: true, mode,
      from: waypoints[0]!, to: waypoints[waypoints.length - 1]!,
      totalTimeMin: +totalTime.toFixed(1), totalDistKm: +totalDist.toFixed(2),
      nEdges: path.edges.length, nWaypoints: waypoints.length, waypoints, segments,
    };
  }
}
