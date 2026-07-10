// Wraps the MapLibre map behind a slim, React-free API (SRP): map setup (dark
// CARTO raster basemap), source/layer helpers, popup, hit queries, and an event
// registry for interactive layers.
import maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource, LayerSpecification, LngLatLike, MapGeoJSONFeature, MapMouseEvent,
} from 'maplibre-gl';

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

export class MapController {
  readonly map: maplibregl.Map;

  private ready = false;
  private readyCbs: Array<() => void> = [];
  private interactive = new Map<string, InteractiveSpec>();
  private hovered = new Set<string>();
  private popup: maplibregl.Popup | null = null;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      // Inline style: dark CARTO raster basemap (keyless; the only direct
      // external access of the browser – all data APIs go through our server).
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution:
              '© OpenStreetMap-Mitwirkende © CARTO · Daten: ' +
              '<a href="https://geoviewer.deutschebahn.com/maps/#/context/ISR/275618" target="_blank" rel="noopener">DB InfraGO</a>' +
              ' · Live-Züge: <a href="https://transitous.org/sources" target="_blank" rel="noopener">Transitous</a>',
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [10.4, 51.2],
      zoom: 5,
      attributionControl: { compact: false },
    });

    this.map.on('load', () => {
      this.ready = true;
      const cbs = this.readyCbs;
      this.readyCbs = [];
      for (const cb of cbs) cb();
    });

    // One global click handler for all interactive layers: the topmost feature
    // wins (queryRenderedFeatures returns in render order, top first).
    this.map.on('click', (e: MapMouseEvent) => this.handleClick(e));
  }

  /** Runs cb once the map style is loaded (or immediately when already ready). */
  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyCbs.push(cb);
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
    const source = this.map.getSource(id) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else this.map.addSource(id, { type: 'geojson', data });
  }

  /** Adds a layer only when it does not exist yet. */
  addLayerOnce(layerSpec: LayerSpecification, before?: string): void {
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
    const popup = new maplibregl.Popup({ maxWidth: `${maxWidthPx}px` }).setLngLat(lngLat);
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

  private handleClick(e: MapMouseEvent): void {
    const hit = this.queryInteractiveAt(e.point)[0];
    if (!hit) return;
    this.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature));
  }

  private updateCursor(): void {
    this.map.getCanvas().style.cursor = this.hovered.size ? 'pointer' : '';
  }
}
