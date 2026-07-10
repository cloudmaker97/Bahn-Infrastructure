// Live trains: polling via our own server API /api/livetrips (NO direct
// Transitous call – the server caches and filters), smooth movement via
// position interpolation (source.setData every 200 ms), "realtime only" filter,
// hover tooltip and detail popup. Single responsibility: train overlay.
import type { LayerSpecification, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl';
import { getLiveTrips } from '@/lib/api';
import { escapeHtml, fmtTimeHM } from '@/lib/format';
import { buildTrack, positionAt, type Track } from '@shared/geo';
import {
  CATEGORY_COLOR, CATEGORY_COLOR_FALLBACK, matchesTrainQuery, type TrainCategory, type TrainDTO,
} from '@shared/live-trips-core';
import { decodePolyline } from '@shared/polyline';
import { emptyFeatureCollection, HoverTooltip, TRAINS_LAYER_ID } from './common';
import type { MapController } from './controller';

const SOURCE_ID = TRAINS_LAYER_ID;
/** Client poll ~15 s (the server caches 10 s per zoom bucket). */
const REFETCH_MS = 15000;
const DEBOUNCE_MS = 400;
/** Update positions ~5x/s – smooth enough and very cheap in WebGL. */
const ANIM_MS = 200;
/** Zoom gate in Transitous zoom levels (MapLibre zoom + 1). */
const MIN_TRANSITOUS_ZOOM = 3;

/** Category color (long-distance red, regional green, suburban blue, fallback grey). */
function categoryColor(category: TrainCategory): string {
  return category === 'other' ? CATEGORY_COLOR_FALLBACK : CATEGORY_COLOR[category];
}

/** Detail popup of a train (texts as in the old frontend public/live-trips.js). */
function trainPopupHtml(props: Record<string, unknown>): string {
  const delay = Number(props['delayMin'] ?? 0);
  const delayTxt = delay > 0
    ? `<span style="color:#d23f3f">+${delay} min</span>`
    : delay < 0 ? `${delay} min` : 'pünktlich';
  const realTime = props['realTime'] === true || props['realTime'] === 'true';
  const timeOf = (key: string) => fmtTimeHM(Number(props[key] ?? 0));
  return `<h3>${escapeHtml(props['name'] || 'Zug')}</h3><table>` +
    `<tr><td class="k">von → nach</td><td>${escapeHtml(props['fromName'] ?? '')} → ${escapeHtml(props['toName'] ?? '')}</td></tr>` +
    `<tr><td class="k">planmäßig</td><td>ab ${timeOf('schedDepartMs')} · an ${timeOf('schedArriveMs')}</td></tr>` +
    `<tr><td class="k">aktuell</td><td>ab ${timeOf('departMs')} · an ${timeOf('arriveMs')}</td></tr>` +
    `<tr><td class="k">Verspätung</td><td>${delayTxt}</td></tr>` +
    `<tr><td class="k">Echtzeit</td><td>${realTime ? 'ja' : 'nein (Plan)'}</td></tr>` +
    `</table>`;
}

/** One loaded train: DTO plus the precomputed track for the interpolation. */
interface TrainEntry {
  dto: TrainDTO;
  track: Track;
}

/** One search hit among the loaded live trains (current interpolated position). */
export interface TrainHit {
  name: string;
  lngLat: [number, number];
}

export class TrainsLayer {
  private entries: TrainEntry[] = [];
  private realtimeOnly: boolean;
  private active = false;
  private layerReady = false;
  private inFlight = false;
  private refetchTimer: ReturnType<typeof setInterval> | null = null;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stamp = '';
  private lastError: string | null = null;
  private tooltip: HoverTooltip;

  // Bound handlers so dispose() can unregister them again.
  private readonly onMoveEnd = (): void => {
    if (this.active) this.scheduleRefetch();
  };
  private readonly onVisibility = (): void => {
    if (!this.active) return;
    if (document.hidden) {
      // Background tab: no refetching (saves network/CPU) …
      this.clearRefetchTimer();
    } else {
      // … refresh immediately on return and resume the interval.
      void this.fetchTrips();
      if (!this.refetchTimer) this.refetchTimer = setInterval(() => void this.fetchTrips(), REFETCH_MS);
    }
  };

  constructor(
    private controller: MapController,
    private onStatus: (text: string) => void,
    opts: { realtimeOnly?: boolean } = {},
  ) {
    this.realtimeOnly = opts.realtimeOnly ?? true;
    this.tooltip = new HoverTooltip(controller.map);

    controller.onReady(() => {
      this.ensureLayer();
      this.layerReady = true;
    });

    // Click: detail popup via the interactive registry (topmost feature wins).
    controller.registerInteractive(TRAINS_LAYER_ID, {
      popupHtml: (f: MapGeoJSONFeature) => trainPopupHtml(f.properties as Record<string, unknown>),
      kindLabel: () => 'Zug',
      nearbyLabel: (f: MapGeoJSONFeature) =>
        String((f.properties as Record<string, unknown>)['name'] || 'Zug'),
      dotColor: (f: MapGeoJSONFeature) =>
        String((f.properties as Record<string, unknown>)['color'] ?? CATEGORY_COLOR_FALLBACK),
    });

    // Hover: a small tooltip popup with the train name.
    controller.map.on('mousemove', TRAINS_LAYER_ID, (e: MapLayerMouseEvent) =>
      this.tooltip.showAt(e, String((e.features?.[0]?.properties as Record<string, unknown>)?.['name'] ?? '')));
    controller.map.on('mouseleave', TRAINS_LAYER_ID, () => this.tooltip.hide());

    controller.map.on('moveend', this.onMoveEnd);
    controller.map.on('zoomend', this.onMoveEnd);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Activates the overlay: load immediately, then every 15 s + debounced on map moves. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.controller.setVisible(TRAINS_LAYER_ID, true);
    void this.fetchTrips();
    this.refetchTimer = setInterval(() => void this.fetchTrips(), REFETCH_MS);
    this.animTimer = setInterval(() => this.renderFrame(), ANIM_MS);
  }

  /** Deactivates the overlay: stop timers, clear trains, clear the status. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.clearRefetchTimer();
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.entries = [];
    this.renderFrame();
    this.controller.setVisible(TRAINS_LAYER_ID, false);
    this.tooltip.hide();
    this.onStatus('');
  }

  /** Toggles the "realtime only" filter (applies immediately to the rendered list). */
  setRealtimeOnly(on: boolean): void {
    this.realtimeOnly = on;
    if (this.active) {
      const shown = this.renderFrame();
      this.updateStatus(shown);
    }
  }

  /**
   * Current positions of the loaded trains matching the query (full name like
   * "ICE 577" or bare train number). Respects the "realtime only" filter so
   * the hits are exactly the trains that are visible on the map.
   */
  locate(query: string): TrainHit[] {
    const candidates = this.realtimeOnly ? this.entries.filter((e) => e.dto.realTime) : this.entries;
    const now = Date.now();
    const hits: TrainHit[] = [];
    for (const { dto, track } of candidates) {
      if (!matchesTrainQuery(dto.name, query)) continue;
      const span = dto.arriveMs - dto.departMs;
      const frac = span > 0 ? (now - dto.departMs) / span : 0;
      const pos = positionAt(track, frac); // [lat, lon]
      if (pos) hits.push({ name: dto.name, lngLat: [pos[1], pos[0]] });
    }
    return hits;
  }

  /** Tears everything down (React cleanup); the controller removes the map itself. */
  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controller.map.off('moveend', this.onMoveEnd);
    this.controller.map.off('zoomend', this.onMoveEnd);
  }

  private ensureLayer(): void {
    this.controller.addOrSetGeoJson(SOURCE_ID, emptyFeatureCollection());
    const layer: LayerSpecification = {
      id: TRAINS_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    };
    this.controller.addLayerOnce(layer);
    this.controller.setVisible(TRAINS_LAYER_ID, this.active);
  }

  private scheduleRefetch(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.fetchTrips(), DEBOUNCE_MS);
  }

  private clearRefetchTimer(): void {
    if (this.refetchTimer) { clearInterval(this.refetchTimer); this.refetchTimer = null; }
  }

  private async fetchTrips(): Promise<void> {
    if (!this.active || this.inFlight) return;
    const zoom = Math.round(this.controller.getTransitousZoom());
    if (zoom < MIN_TRANSITOUS_ZOOM) {
      this.entries = [];
      this.renderFrame();
      this.onStatus('Live-Züge: zum Anzeigen näher heranzoomen');
      return;
    }
    this.inFlight = true;
    try {
      const res = await getLiveTrips(zoom);
      this.entries = (res.trains ?? []).map((dto) => ({
        dto,
        track: buildTrack(decodePolyline(dto.polyline)),
      }));
      this.lastError = res.error;
      this.stamp = new Date().toLocaleTimeString('de-DE');
      const shown = this.renderFrame();
      this.updateStatus(shown);
    } catch (err) {
      this.onStatus(`Live-Züge nicht verfügbar (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Draws the current animation frame: each train's position interpolated from
   * the time fraction between departure and arrival. @returns shown train count.
   */
  private renderFrame(): number {
    if (!this.layerReady) return 0;
    const shown = this.realtimeOnly ? this.entries.filter((e) => e.dto.realTime) : this.entries;
    const now = Date.now();
    const features: GeoJSON.Feature[] = [];
    for (const { dto, track } of shown) {
      const span = dto.arriveMs - dto.departMs;
      const frac = span > 0 ? (now - dto.departMs) / span : 0;
      const pos = positionAt(track, frac); // [lat, lon]
      if (!pos) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pos[1], pos[0]] },
        properties: {
          id: dto.id,
          name: dto.name,
          category: dto.category,
          color: categoryColor(dto.category),
          delayMin: dto.delayMin,
          realTime: dto.realTime,
          fromName: dto.fromName,
          toName: dto.toName,
          departMs: dto.departMs,
          arriveMs: dto.arriveMs,
          schedDepartMs: dto.schedDepartMs,
          schedArriveMs: dto.schedArriveMs,
        },
      });
    }
    this.controller.addOrSetGeoJson(SOURCE_ID, { type: 'FeatureCollection', features });
    return features.length;
  }

  private updateStatus(shown: number): void {
    if (!this.active) return;
    // Do not report a (misleading) count before the first successful load.
    if (!this.stamp && !this.lastError) return;
    if (this.lastError) {
      this.onStatus(`Live-Züge nicht verfügbar (${this.lastError})`);
      return;
    }
    // The server always delivers all trains in Germany (DE bbox, cached) – not just the viewport.
    this.onStatus(
      `Live-Züge: ${shown} in Deutschland${this.realtimeOnly ? ' (nur Echtzeit)' : ''}` +
      (this.stamp ? ` · Stand ${this.stamp}` : ''),
    );
  }
}
