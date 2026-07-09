// Live-Züge: Poll über die eigene Server-API /api/livetrips (KEIN direkter
// Transitous-Aufruf – der Server cached und filtert), flüssige Bewegung über
// Positions-Interpolation (source.setData im 200-ms-Takt), Filter „Nur Echtzeit",
// Hover-Tooltip und Detail-Popup. Eine Verantwortung: Zug-Overlay.
import maplibregl from 'maplibre-gl';
import type { LayerSpecification, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl';
import { getLiveTrips } from '@/lib/api';
import { escapeHtml, fmtTimeHM } from '@/lib/format';
import { buildTrack, positionAt, type Track } from '@shared/geo';
import {
  CATEGORY_COLOR, CATEGORY_COLOR_FALLBACK, type TrainCategory, type TrainDTO,
} from '@shared/live-trips-core';
import { decodePolyline } from '@shared/polyline';
import type { MapController } from './controller';

const SOURCE_ID = 'trains';
const LAYER_ID = 'trains';
/** Client-Poll ~15 s (der Server cached 10 s je Zoom-Bucket). */
const REFETCH_MS = 15000;
const DEBOUNCE_MS = 400;
/** Positionen ~5x/s aktualisieren – flüssig genug, sehr günstig in WebGL. */
const ANIM_MS = 200;
/** Zoom-Gate in Transitous-Zoomstufen (MapLibre-Zoom + 1). */
const MIN_TRANSITOUS_ZOOM = 3;

/** Kategorie-Farbe (fern rot, regio grün, sbahn blau, Fallback grau). */
function categoryColor(category: TrainCategory): string {
  return category === 'other' ? CATEGORY_COLOR_FALLBACK : CATEGORY_COLOR[category];
}

/** Detail-Popup eines Zuges (Texte wie im Alt-Frontend public/live-trips.js). */
function trainPopupHtml(props: Record<string, unknown>): string {
  const delay = Number(props['delayMin'] ?? 0);
  const delayTxt = delay > 0
    ? `<span style="color:#d23f3f">+${delay} min</span>`
    : delay < 0 ? `${delay} min` : 'pünktlich';
  const realTime = props['realTime'] === true || props['realTime'] === 'true';
  const zeit = (key: string) => fmtTimeHM(Number(props[key] ?? 0));
  return `<h3>${escapeHtml(props['name'] || 'Zug')}</h3><table>` +
    `<tr><td class="k">von → nach</td><td>${escapeHtml(props['fromName'] ?? '')} → ${escapeHtml(props['toName'] ?? '')}</td></tr>` +
    `<tr><td class="k">planmäßig</td><td>ab ${zeit('schedDepartMs')} · an ${zeit('schedArriveMs')}</td></tr>` +
    `<tr><td class="k">aktuell</td><td>ab ${zeit('departMs')} · an ${zeit('arriveMs')}</td></tr>` +
    `<tr><td class="k">Verspätung</td><td>${delayTxt}</td></tr>` +
    `<tr><td class="k">Echtzeit</td><td>${realTime ? 'ja' : 'nein (Plan)'}</td></tr>` +
    `</table>`;
}

/** Ein geladener Zug: DTO plus vorberechneter Fahrweg für die Interpolation. */
interface TrainEntry {
  dto: TrainDTO;
  track: Track;
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
  private fehler: string | null = null;
  private tooltip: maplibregl.Popup | null = null;

  // Gebundene Handler, damit dispose() sie wieder abmelden kann.
  private readonly onMoveEnd = (): void => {
    if (this.active) this.scheduleRefetch();
  };
  private readonly onVisibility = (): void => {
    if (!this.active) return;
    if (document.hidden) {
      // Hintergrund-Tab: kein Nachladen (spart Netz/CPU) …
      this.clearRefetchTimer();
    } else {
      // … beim Zurückkehren sofort aktualisieren und den Takt wieder aufnehmen.
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

    controller.onReady(() => {
      this.ensureLayer();
      this.layerReady = true;
    });

    // Klick: Detail-Popup über die Interaktiv-Registry (oberstes Feature gewinnt).
    controller.registerInteractive(LAYER_ID, {
      popupHtml: (f: MapGeoJSONFeature) => trainPopupHtml(f.properties as Record<string, unknown>),
      kindLabel: () => 'Zug',
      nearbyLabel: (f: MapGeoJSONFeature) =>
        String((f.properties as Record<string, unknown>)['name'] || 'Zug'),
      dotColor: (f: MapGeoJSONFeature) =>
        String((f.properties as Record<string, unknown>)['color'] ?? CATEGORY_COLOR_FALLBACK),
    });

    // Hover: kleines Tooltip-Popup mit dem Zugnamen.
    controller.map.on('mousemove', LAYER_ID, (e: MapLayerMouseEvent) => this.showTooltip(e));
    controller.map.on('mouseleave', LAYER_ID, () => this.hideTooltip());

    controller.map.on('moveend', this.onMoveEnd);
    controller.map.on('zoomend', this.onMoveEnd);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Overlay aktivieren: sofort laden, dann alle 15 s + debounced bei Kartenbewegung. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.controller.setVisible(LAYER_ID, true);
    void this.fetchTrips();
    this.refetchTimer = setInterval(() => void this.fetchTrips(), REFETCH_MS);
    this.animTimer = setInterval(() => this.renderFrame(), ANIM_MS);
  }

  /** Overlay deaktivieren: Timer stoppen, Züge leeren, Status löschen. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.clearRefetchTimer();
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.entries = [];
    this.renderFrame();
    this.controller.setVisible(LAYER_ID, false);
    this.hideTooltip();
    this.onStatus('');
  }

  /** Filter „Nur Echtzeit" umschalten (wirkt sofort auf die gerenderte Liste). */
  setRealtimeOnly(on: boolean): void {
    this.realtimeOnly = on;
    if (this.active) {
      const shown = this.renderFrame();
      this.updateStatus(shown);
    }
  }

  /** Alles abbauen (React-cleanup); die Karte selbst räumt der Controller ab. */
  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controller.map.off('moveend', this.onMoveEnd);
    this.controller.map.off('zoomend', this.onMoveEnd);
  }

  private ensureLayer(): void {
    this.controller.addOrSetGeoJson(SOURCE_ID, { type: 'FeatureCollection', features: [] });
    const layer: LayerSpecification = {
      id: LAYER_ID,
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
    this.controller.setVisible(LAYER_ID, this.active);
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
      this.fehler = res.error;
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
   * Zeichnet den aktuellen Animationsstand: Position je Zug aus dem Zeitanteil
   * zwischen Abfahrt und Ankunft interpoliert. @returns Anzahl gezeigter Züge.
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
    // Vor dem ersten erfolgreichen Laden keine (irreführende) Zählung melden.
    if (!this.stamp && !this.fehler) return;
    if (this.fehler) {
      this.onStatus(`Live-Züge nicht verfügbar (${this.fehler})`);
      return;
    }
    // Der Server liefert immer alle Züge Deutschlands (DE-Bbox, gecacht) – nicht nur den Ausschnitt.
    this.onStatus(
      `Live-Züge: ${shown} in Deutschland${this.realtimeOnly ? ' (nur Echtzeit)' : ''}` +
      (this.stamp ? ` · Stand ${this.stamp}` : ''),
    );
  }

  private showTooltip(e: MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    const name = String((f.properties as Record<string, unknown>)?.['name'] ?? '');
    if (!name) { this.hideTooltip(); return; }
    const pos: [number, number] = f.geometry.type === 'Point'
      ? [f.geometry.coordinates[0]!, f.geometry.coordinates[1]!]
      : [e.lngLat.lng, e.lngLat.lat];
    if (!this.tooltip) {
      this.tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    }
    this.tooltip.setLngLat(pos).setHTML(escapeHtml(name)).addTo(this.controller.map);
  }

  private hideTooltip(): void {
    this.tooltip?.remove();
  }
}
