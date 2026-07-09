// Kapselt die MapLibre-Karte hinter einer schmalen, React-freien API (SRP):
// Karten-Setup (dunkles CARTO-Raster-Basemap), Quellen/Layer-Helfer, Popup,
// Treffer-Abfragen und eine Event-Registry für interaktive Layer.
import maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource, LayerSpecification, LngLatLike, MapGeoJSONFeature, MapMouseEvent,
} from 'maplibre-gl';

/** Beschreibung eines interaktiven Layers (Klick-Popup + Rechtsklick-Liste). */
export interface InteractiveSpec {
  /** HTML (oder DOM-Knoten) für das Klick-Popup eines Features. */
  popupHtml(feature: MapGeoJSONFeature): string | HTMLElement;
  /** Typ-Beschriftung (z. B. „Strecke", „Zug") für die Nearby-Auswahlliste. */
  kindLabel(feature: MapGeoJSONFeature): string;
  /** Beschriftung des Features in der Nearby-Auswahlliste (Fallback: kindLabel). */
  nearbyLabel?(feature: MapGeoJSONFeature): string;
  /** Farbpunkt des Features in der Nearby-Auswahlliste (Fallback: Grau). */
  dotColor?(feature: MapGeoJSONFeature): string;
}

/** Ein interaktiver Treffer einer Punktabfrage (oberstes Feature zuerst). */
export interface InteractiveHit {
  feature: MapGeoJSONFeature;
  spec: InteractiveSpec;
}

/** Klick-Trefferradius in Pixeln (dünne Linien / kleine, bewegte Punkte). */
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
      // Inline-Style: dunkles CARTO-Raster-Basemap (keyless; einziger direkter
      // externer Zugriff des Browsers – alle Daten-APIs laufen über unseren Server).
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

    // Ein globaler Klick-Handler für alle interaktiven Layer: das oberste Feature
    // gewinnt (queryRenderedFeatures liefert in Render-Reihenfolge, oben zuerst).
    this.map.on('click', (e: MapMouseEvent) => this.handleClick(e));
  }

  /** Führt cb aus, sobald der Karten-Style geladen ist (oder sofort, wenn schon bereit). */
  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyCbs.push(cb);
  }

  /**
   * ACHTUNG Zoom-Konvention: MapLibre rechnet auf 512er-Kachelbasis, Leaflet und
   * Transitous auf 256er – MapLibre-Zoom ≈ Leaflet-/Transitous-Zoom − 1.
   * Für /api/livetrips (Transitous-Zoom) daher +1.
   */
  getTransitousZoom(): number {
    return this.map.getZoom() + 1;
  }

  /** Legt eine GeoJSON-Source an oder aktualisiert ihre Daten (idempotent). */
  addOrSetGeoJson(id: string, data: GeoJSON.GeoJSON): void {
    const source = this.map.getSource(id) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else this.map.addSource(id, { type: 'geojson', data });
  }

  /** Fügt einen Layer nur hinzu, wenn er noch nicht existiert. */
  addLayerOnce(layerSpec: LayerSpecification, before?: string): void {
    if (this.map.getLayer(layerSpec.id)) return;
    // `before` nur verwenden, wenn der Ziel-Layer existiert (robust bei Ladereihenfolge).
    this.map.addLayer(layerSpec, before && this.map.getLayer(before) ? before : undefined);
  }

  /** Layer-Sichtbarkeit über die visibility-Layout-Eigenschaft schalten. */
  setVisible(layerId: string, on: boolean): void {
    if (!this.map.getLayer(layerId)) return;
    this.map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
  }

  /** Gerenderte Features in einer Pixel-Bbox um den Punkt (nur existierende Layer). */
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

  /** Interaktive Treffer (oberstes Feature zuerst) im Radius um den Punkt. */
  queryInteractiveAt(point: { x: number; y: number }, radiusPx: number = CLICK_RADIUS_PX): InteractiveHit[] {
    const feats = this.queryAt(point, { radiusPx, layers: [...this.interactive.keys()] });
    const hits: InteractiveHit[] = [];
    for (const feature of feats) {
      const spec = this.interactive.get(feature.layer.id);
      if (spec) hits.push({ feature, spec });
    }
    return hits;
  }

  /** Öffnet ein Popup (schließt ein ggf. offenes vorher). */
  openPopup(lngLat: LngLatLike, content: string | HTMLElement, maxWidthPx = 380): void {
    this.popup?.remove();
    const popup = new maplibregl.Popup({ maxWidth: `${maxWidthPx}px` }).setLngLat(lngLat);
    if (typeof content === 'string') popup.setHTML(content);
    else popup.setDOMContent(content);
    popup.addTo(this.map);
    this.popup = popup;
  }

  /**
   * Registriert einen Layer als interaktiv: Klick öffnet das Popup des obersten
   * Features, Hover zeigt den Pointer-Cursor. Die Registry nutzt der Folgeschritt
   * auch für die Rechtsklick-Liste („Elemente in der Nähe").
   */
  registerInteractive(layerId: string, spec: InteractiveSpec): void {
    this.interactive.set(layerId, spec);
    // Delegierte Events funktionieren auch, wenn der Layer erst später angelegt wird.
    this.map.on('mouseenter', layerId, () => {
      this.hovered.add(layerId);
      this.updateCursor();
    });
    this.map.on('mouseleave', layerId, () => {
      this.hovered.delete(layerId);
      this.updateCursor();
    });
  }

  /** Karte und Ressourcen freigeben (React-cleanup). */
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
