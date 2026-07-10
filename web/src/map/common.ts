// Small helpers shared by the map layer modules (single source instead of the
// per-module copies): layer ordering, empty collections, hover tooltip.
import maplibregl from 'maplibre-gl';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { escapeHtml } from '@/lib/format';

/**
 * ID of the live-trains layer. All other overlays insert themselves BEFORE this
 * layer so the trains always render on top.
 */
export const TRAINS_LAYER_ID = 'trains';

/** Empty FeatureCollection (initial data / clearing of GeoJSON sources). */
export function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Small hover tooltip (text-only popup without a close button), lazily created.
 * Used by the trains layer (train names) and the route layer (start/end labels).
 */
export class HoverTooltip {
  private popup: maplibregl.Popup | null = null;

  constructor(private map: maplibregl.Map) {}

  /** Shows `text` at the hovered feature (point features anchor exactly). */
  showAt(e: MapLayerMouseEvent, text: string): void {
    if (!text) { this.hide(); return; }
    const f = e.features?.[0];
    const pos: [number, number] = f && f.geometry.type === 'Point'
      ? [(f.geometry.coordinates as number[])[0]!, (f.geometry.coordinates as number[])[1]!]
      : [e.lngLat.lng, e.lngLat.lat];
    if (!this.popup) {
      this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    }
    this.popup.setLngLat(pos).setHTML(escapeHtml(text)).addTo(this.map);
  }

  hide(): void {
    this.popup?.remove();
  }
}
