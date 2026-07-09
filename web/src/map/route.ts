// Routen-Overlay: zeichnet das /api/route-Ergebnis (rote Linie + Start-/Zielpunkt
// mit Hover-Tooltip) und zoomt auf die Route. ACHTUNG: der Server liefert
// segments[].coords als [lat, lon] (Leaflet-Konvention, siehe
// src/routing/route-service.ts) – für MapLibre nach [lon, lat] drehen.
import maplibregl from 'maplibre-gl';
import type { LayerSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import { escapeHtml } from '@/lib/format';
import type { RouteResult, RouteWaypoint } from '@/lib/types';
import type { MapController } from './controller';

const LINE_SOURCE = 'route-line';
const LINE_LAYER = 'route-line';
const POINT_SOURCE = 'route-points';
const POINT_LAYER = 'route-points';
/** Vor den Zug-Layer einfügen, damit die Züge über der Route liegen. */
const TRAINS_LAYER_ID = 'trains';

/** Leere FeatureCollection (zum Anlegen und Leeren der Sources). */
function leer(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

export class RouteLayer {
  private layersReady = false;
  private tooltip: maplibregl.Popup | null = null;

  constructor(private controller: MapController) {
    // Hover-Tooltip für Start-/Zielpunkt (delegiert; greift, sobald der Layer existiert).
    controller.map.on('mousemove', POINT_LAYER, (e: MapLayerMouseEvent) => this.showTooltip(e));
    controller.map.on('mouseleave', POINT_LAYER, () => this.tooltip?.remove());
  }

  /** Route zeichnen (Linie + Start/Ziel) und auf die Gesamtausdehnung zoomen. */
  show(route: RouteResult): void {
    this.controller.onReady(() => {
      this.ensureLayers();
      // [lat, lon] -> [lon, lat] drehen (Server nutzt die Leaflet-Konvention).
      const linien: GeoJSON.Feature[] = route.segments.map((s) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords.map(([lat, lon]) => [lon, lat]) },
        properties: {},
      }));
      this.controller.addOrSetGeoJson(LINE_SOURCE, { type: 'FeatureCollection', features: linien });

      const punkte: GeoJSON.Feature[] = [];
      const punkt = (wp: RouteWaypoint, farbe: string, rolle: string): void => {
        if (wp.lat == null || wp.lon == null) return;
        punkte.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wp.lon, wp.lat] },
          properties: { farbe, beschriftung: `${rolle}: ${wp.rl100 || ''} ${wp.name || ''}` },
        });
      };
      punkt(route.from, '#38b48b', 'Start');
      punkt(route.to, '#ff2d55', 'Ziel');
      this.controller.addOrSetGeoJson(POINT_SOURCE, { type: 'FeatureCollection', features: punkte });

      const bounds = new maplibregl.LngLatBounds();
      for (const s of route.segments) for (const [lat, lon] of s.coords) bounds.extend([lon, lat]);
      if (!bounds.isEmpty()) this.controller.map.fitBounds(bounds, { padding: 60 });
    });
  }

  /** Route von der Karte entfernen (Sources leeren, Layer bleiben bestehen). */
  clear(): void {
    this.tooltip?.remove();
    if (!this.layersReady) return;
    this.controller.addOrSetGeoJson(LINE_SOURCE, leer());
    this.controller.addOrSetGeoJson(POINT_SOURCE, leer());
  }

  private ensureLayers(): void {
    if (this.layersReady) return;
    this.controller.addOrSetGeoJson(LINE_SOURCE, leer());
    this.controller.addOrSetGeoJson(POINT_SOURCE, leer());
    const lineLayer: LayerSpecification = {
      id: LINE_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      paint: { 'line-color': '#ff2d55', 'line-width': 5, 'line-opacity': 0.9 },
    };
    const pointLayer: LayerSpecification = {
      id: POINT_LAYER,
      type: 'circle',
      source: POINT_SOURCE,
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'farbe'],
        'circle-stroke-color': '#111111',
        'circle-stroke-width': 2,
      },
    };
    this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(pointLayer, TRAINS_LAYER_ID);
    this.layersReady = true;
  }

  private showTooltip(e: MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    const text = String((f.properties as Record<string, unknown>)?.['beschriftung'] ?? '');
    if (!text) return;
    const pos: [number, number] = f.geometry.type === 'Point'
      ? [f.geometry.coordinates[0]!, f.geometry.coordinates[1]!]
      : [e.lngLat.lng, e.lngLat.lat];
    if (!this.tooltip) {
      this.tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    }
    this.tooltip.setLngLat(pos).setHTML(escapeHtml(text)).addTo(this.controller.map);
  }
}
