// Route overlay: draws the /api/route result (red line + start/end points with
// hover tooltip) and zooms to the route. NOTE: the server delivers
// segments[].coords as [lat, lon] (see src/routing/route-service.ts) – rotate
// to [lon, lat] for MapLibre.
import maplibregl from 'maplibre-gl';
import type { LayerSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import type { RouteResult, RouteWaypoint } from '@/lib/types';
import { emptyFeatureCollection, HoverTooltip, TRAINS_LAYER_ID } from './common';
import type { MapController } from './controller';

const LINE_SOURCE = 'route-line';
const LINE_LAYER = 'route-line';
const POINT_SOURCE = 'route-points';
const POINT_LAYER = 'route-points';

export class RouteLayer {
  private layersReady = false;
  private tooltip: HoverTooltip;

  constructor(private controller: MapController) {
    this.tooltip = new HoverTooltip(controller.map);
    // Hover tooltip for start/end points (delegated; applies once the layer exists).
    controller.map.on('mousemove', POINT_LAYER, (e: MapLayerMouseEvent) =>
      this.tooltip.showAt(e, String((e.features?.[0]?.properties as Record<string, unknown>)?.['label'] ?? '')));
    controller.map.on('mouseleave', POINT_LAYER, () => this.tooltip.hide());
  }

  /** Draws the route (line + start/end) and zooms to its full extent. */
  show(route: RouteResult): void {
    this.controller.onReady(() => {
      this.ensureLayers();
      // Rotate [lat, lon] -> [lon, lat] (the server uses the [lat, lon] convention).
      const lines: GeoJSON.Feature[] = route.segments.map((s) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords.map(([lat, lon]) => [lon, lat]) },
        properties: {},
      }));
      this.controller.addOrSetGeoJson(LINE_SOURCE, { type: 'FeatureCollection', features: lines });

      const points: GeoJSON.Feature[] = [];
      const point = (wp: RouteWaypoint, color: string, role: string): void => {
        if (wp.lat == null || wp.lon == null) return;
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wp.lon, wp.lat] },
          properties: { color, label: `${role}: ${wp.rl100 || ''} ${wp.name || ''}` },
        });
      };
      point(route.from, '#38b48b', 'Start');
      point(route.to, '#ff2d55', 'Ziel');
      this.controller.addOrSetGeoJson(POINT_SOURCE, { type: 'FeatureCollection', features: points });

      const bounds = new maplibregl.LngLatBounds();
      for (const s of route.segments) for (const [lat, lon] of s.coords) bounds.extend([lon, lat]);
      if (!bounds.isEmpty()) this.controller.map.fitBounds(bounds, { padding: 60 });
    });
  }

  /** Removes the route from the map (clears the sources, the layers stay). */
  clear(): void {
    this.tooltip.hide();
    if (!this.layersReady) return;
    this.controller.addOrSetGeoJson(LINE_SOURCE, emptyFeatureCollection());
    this.controller.addOrSetGeoJson(POINT_SOURCE, emptyFeatureCollection());
  }

  private ensureLayers(): void {
    if (this.layersReady) return;
    this.controller.addOrSetGeoJson(LINE_SOURCE, emptyFeatureCollection());
    this.controller.addOrSetGeoJson(POINT_SOURCE, emptyFeatureCollection());
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
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#111111',
        'circle-stroke-width': 2,
      },
    };
    // Insert before the trains layer so the trains render above the route.
    this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(pointLayer, TRAINS_LAYER_ID);
    this.layersReady = true;
  }
}
