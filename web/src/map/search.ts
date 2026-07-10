// Unified map search over the three result kinds: line number (highlight +
// zoom via RailNetworkLayer), exact RL100 operating point (/api/stations), and
// live train (name/number among the loaded trains). Returns the German status
// line for the side panel. Single responsibility: search orchestration.
import maplibregl from 'maplibre-gl';
import { getStations } from '@/lib/api';
import { escapeHtml } from '@/lib/format';
import type { StationSuggestion } from '@/lib/types';
import type { MapController } from './controller';
import type { RailNetworkLayer } from './rail-network';
import type { TrainsLayer } from './trains';

const STATION_ZOOM = 13;
/** Trains keep moving – do not zoom in so far that the hit leaves the view quickly. */
const TRAIN_MAX_ZOOM = 11;

/** RL100 operating point with a map position (only those can be shown). */
type LocatedStation = StationSuggestion & { lat: number; lon: number };

export class MapSearch {
  constructor(
    private controller: MapController,
    private railNetwork: RailNetworkLayer,
    private trains: TrainsLayer,
  ) {}

  /**
   * Resolves the query in order line -> RL100 -> live train (the kinds barely
   * overlap: line numbers are numeric, RL100 codes alphabetic, train hits
   * require the full name or the complete train number).
   * @returns status line for the panel ('' for an empty query).
   */
  async search(q: string): Promise<string> {
    const query = q.trim();
    if (!query) return '';

    const sections = this.railNetwork.search(query);
    if (sections > 0) return `Strecke ${query}: ${sections} Abschnitt(e)`;

    const station = await this.findStationByRl100(query);
    if (station) {
      this.showStation(station);
      return `${station.rl100}: ${station.name}`;
    }

    const trains = this.trains.locate(query);
    if (trains.length > 0) {
      this.showTrains(trains.map((t) => t.lngLat));
      return trains.length === 1
        ? `Zug ${trains[0]!.name} gefunden`
        : `${trains.length} Züge zu „${query}“ gefunden`;
    }

    return `„${query}“ nicht gefunden (Strecke, RL100 oder Live-Zug)`;
  }

  /** Exact RL100 match (case-insensitive) with a usable position, or null. */
  private async findStationByRl100(query: string): Promise<LocatedStation | null> {
    const code = query.toUpperCase();
    try {
      const suggestions = await getStations(query);
      return suggestions.find(
        (s): s is LocatedStation => s.rl100?.toUpperCase() === code && s.lat != null && s.lon != null,
      ) ?? null;
    } catch {
      return null; // suggest API unreachable -> treat as "no station hit"
    }
  }

  private showStation(station: LocatedStation): void {
    this.railNetwork.clearHighlight(); // a stale line highlight would distract
    const center: [number, number] = [station.lon, station.lat];
    this.controller.map.flyTo({ center, zoom: STATION_ZOOM });
    this.controller.openPopup(center,
      `<h3>${escapeHtml(station.name)}</h3><table>` +
      `<tr><td class="k">RL100</td><td>${escapeHtml(station.rl100)}</td></tr></table>`);
  }

  private showTrains(positions: Array<[number, number]>): void {
    this.railNetwork.clearHighlight();
    const bounds = new maplibregl.LngLatBounds();
    for (const lngLat of positions) bounds.extend(lngLat);
    this.controller.map.fitBounds(bounds, { padding: 80, maxZoom: TRAIN_MAX_ZOOM });
  }
}
