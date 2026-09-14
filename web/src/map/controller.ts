// Wraps the MapLibre map behind a slim, React-free API (SRP): map setup
// (vector GL basemap from tiles.map.apps.dennis-heinri.ch), source/layer
// helpers, popup, hit queries, and an event registry for interactive layers.
import maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource, LayerSpecification, LngLatLike, MapGeoJSONFeature, MapMouseEvent,
} from 'maplibre-gl';
import {
  DATA_ATTRIBUTION, DEFAULT_BASEMAP, styleUrl, type BasemapId,
} from './basemap';

/** Description of an interactive layer (click popup + right-click list). */
export interface InteractiveSpec {
  /** HTML (or DOM node) for the click popup of a feature. */
  popupHtml(feature: MapGeoJSONFeature): string | HTMLElement;
  /** Kind caption (e.g. "Strecke", "Zug") for the nearby selection list. */
  kindLabel(feature: MapGeoJSONFeature): string;
  /** Caption of the feature in the nearby selection list (fallback: kindLabel). */
  nearbyLabel?(feature: MapGeoJSONFeature): string;
  /** Color dot of the feature in the nearby selection list (fallback: grey). */
  dotColor?(feature: MapGeoJSONFeature): string;
}

/** One interactive hit of a point query (topmost feature first). */
export interface InteractiveHit {
  feature: MapGeoJSONFeature;
  spec: InteractiveSpec;
}

/** Click hit radius in pixels (thin lines / small, moving points). */
const CLICK_RADIUS_PX = 6;
/** Left padding matching the docked side panel so flyTo/fitBounds center in the visible map. */
const DESKTOP_LEFT_PADDING_PX = 332;
const NARROW_MQ = '(max-width: 767px), (max-width: 960px) and (max-height: 500px)';

export class MapController {
  readonly map: maplibregl.Map;

  private ready = false;
  private readyCbs: Array<() => void> = [];
  /** Persistent listeners: fire on every style.load (including the first). */
  private styleLoadCbs: Array<() => void> = [];
  private interactive = new Map<string, InteractiveSpec>();
  private hovered = new Set<string>();
  private lastLeftPadding = -1;
  private popup: maplibregl.Popup | null = null;
  private basemapId: BasemapId;

  constructor(container: HTMLElement, initialBasemap: BasemapId = DEFAULT_BASEMAP) {
    this.basemapId = initialBasemap;
    this.map = new maplibregl.Map({
      container,
      style: styleUrl(initialBasemap),
      center: [10.4, 51.2],
      zoom: 5,
      attributionControl: { compact: true, customAttribution: DATA_ATTRIBUTION },
    });

    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      'bottom-left',
    );

    // style.load fires for the initial style and after every setStyle – overlays
    // re-attach there. `load` only fires once and is too late for style swaps.
    this.map.on('style.load', () => this.handleStyleLoad());
    this.map.on('resize', () => this.syncLayout());
    this.map.on('click', (e: MapMouseEvent) => this.handleClick(e));
  }

  getBasemap(): BasemapId {
    return this.basemapId;
  }

  /**
   * Swaps the vector GL basemap. Custom overlay sources/layers are dropped by
   * setStyle; registered onStyleLoad callbacks re-add them.
   */
  setBasemap(id: BasemapId): void {
    if (id === this.basemapId) return;
    this.basemapId = id;
    this.ready = false;
    this.popup?.remove();
    this.popup = null;
    this.map.setStyle(styleUrl(id));
  }

  /** Runs cb once the current style is loaded (or immediately when already ready). */
  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyCbs.push(cb);
  }

  /**
   * Fires on every style.load (including the first). Overlay modules use this
   * to re-create sources/layers after a basemap switch.
   */
  onStyleLoad(cb: () => void): void {
    this.styleLoadCbs.push(cb);
    if (this.ready) cb();
  }

  /**
   * NOTE zoom convention: MapLibre computes on a 512px tile base, Leaflet and
   * Transitous on 256px – MapLibre zoom ≈ Leaflet/Transitous zoom − 1.
   * Hence +1 for /api/livetrips (Transitous zoom).
   */
  getTransitousZoom(): number {
    return this.map.getZoom() + 1;
  }

  /** Creates a GeoJSON source or updates its data (idempotent). */
  addOrSetGeoJson(id: string, data: GeoJSON.GeoJSON): void {
    // Gate on `ready` (style.load), not isStyleLoaded(): the latter stays false
    // until every basemap tile/glyph/sprite is in, so overlays would be skipped
    // if the ISR GeoJSON arrived first.
    if (!this.ready) return;
    const source = this.map.getSource(id) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else this.map.addSource(id, { type: 'geojson', data });
  }

  /** Adds a layer only when it does not exist yet. */
  addLayerOnce(layerSpec: LayerSpecification, before?: string): void {
    if (!this.ready) return;
    if (this.map.getLayer(layerSpec.id)) return;
    // Use `before` only when the target layer exists (robust against load order).
    this.map.addLayer(layerSpec, before && this.map.getLayer(before) ? before : undefined);
  }

  /** Toggles layer visibility via the visibility layout property. */
  setVisible(layerId: string, on: boolean): void {
    if (!this.map.getLayer(layerId)) return;
    this.map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
  }

  /** Rendered features in a pixel bbox around the point (existing layers only). */
  queryAt(point: { x: number; y: number }, opts: { radiusPx: number; layers: string[] }): MapGeoJSONFeature[] {
    const layers = opts.layers.filter((id) => this.map.getLayer(id));
    if (!layers.length) return [];
    const r = opts.radiusPx;
    return this.map.queryRenderedFeatures(
      [
        [point.x - r, point.y - r],
        [point.x + r, point.y + r],
      ],
      { layers },
    );
  }

  /** Interactive hits (topmost feature first) within the radius around the point. */
  queryInteractiveAt(point: { x: number; y: number }, radiusPx: number = CLICK_RADIUS_PX): InteractiveHit[] {
    const feats = this.queryAt(point, { radiusPx, layers: [...this.interactive.keys()] });
    const hits: InteractiveHit[] = [];
    for (const feature of feats) {
      const spec = this.interactive.get(feature.layer.id);
      if (spec) hits.push({ feature, spec });
    }
    return hits;
  }

  /** Opens a popup (closes a possibly open one first). */
  openPopup(lngLat: LngLatLike, content: string | HTMLElement, maxWidthPx = 380): void {
    this.popup?.remove();
    const width = Math.min(maxWidthPx, Math.max(220, window.innerWidth - 24));
    const popup = new maplibregl.Popup({ maxWidth: `${width}px` }).setLngLat(lngLat);
    if (typeof content === 'string') popup.setHTML(content);
    else popup.setDOMContent(content);
    popup.addTo(this.map);
    this.popup = popup;
  }

  /**
   * Registers a layer as interactive: click opens the popup of the topmost
   * feature, hover shows the pointer cursor. The registry is also used by the
   * right-click list ("Elemente in der Nähe").
   */
  registerInteractive(layerId: string, spec: InteractiveSpec): void {
    this.interactive.set(layerId, spec);
    // Delegated events also work when the layer is created later.
    this.map.on('mouseenter', layerId, () => {
      this.hovered.add(layerId);
      this.updateCursor();
    });
    this.map.on('mouseleave', layerId, () => {
      this.hovered.delete(layerId);
      this.updateCursor();
    });
  }

  /** Releases the map and resources (React cleanup). */
  dispose(): void {
    this.popup?.remove();
    this.popup = null;
    this.map.remove();
  }

  /** Desktop: keep geographic center in the map strip beside the docked panel. */
  private syncLayout(): void {
    if (!this.ready) return;
    const canvas = this.map.getCanvas();
    const width = canvas?.clientWidth ?? 0;
    const left = window.matchMedia(NARROW_MQ).matches ? 0 : DESKTOP_LEFT_PADDING_PX;
    if (left > 0 && width > 0 && left >= width) return;
    if (left !== this.lastLeftPadding) {
      this.lastLeftPadding = left;
      this.map.setPadding({ top: 0, right: 0, bottom: 0, left });
    }
    this.collapseCompactAttrib();
  }

  /** On phones keep the attribution as the compact "i" so it does not collide with Abfahrten. */
  private collapseCompactAttrib(): void {
    if (!window.matchMedia(NARROW_MQ).matches) return;
    const el = this.map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    if (el instanceof HTMLDetailsElement) el.open = false;
  }

  private handleStyleLoad(): void {
    this.ready = true;
    this.syncLayout();
    const queued = this.readyCbs;
    this.readyCbs = [];
    for (const cb of queued) cb();
    for (const cb of this.styleLoadCbs) cb();
  }

  private handleClick(e: MapMouseEvent): void {
    const hit = this.queryInteractiveAt(e.point)[0];
    if (!hit) return;
    this.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature));
  }

  private updateCursor(): void {
    this.map.getCanvas().style.cursor = this.hovered.size ? 'pointer' : '';
  }
}
