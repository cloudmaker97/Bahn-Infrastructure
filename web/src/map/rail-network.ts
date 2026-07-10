// Rail-network layer: loads the (large) section GeoJSON with streaming progress,
// builds the indexes (line number, operating-point id) and colors the lines per
// color mode via data-driven color expressions. Single responsibility: rail network.
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import { fetchJsonWithProgress } from '@/lib/api';
import { escapeHtml } from '@/lib/format';
import { COLOR_EXPR, colorForProps, type ColorMode } from './color-scales';
import { TRAINS_LAYER_ID } from './common';
import type { MapController } from './controller';

export type { ColorMode } from './color-scales';

const DATA_URL = '/data/map_streckenabschnitte.geojson';
const SOURCE_ID = 'rail-network';
const LINE_LAYER_ID = 'rail-network-line';
const HIGHLIGHT_LAYER_ID = 'rail-network-highlight';

/** Field captions of the section popup (order = display order; German UI text). */
const LABELS: Record<string, string> = {
  ISR_STRE_NR: 'Streckennr.', STRECKEN_ABSCHNITT: 'Abschnitt', ISR_STRECKE_VON_BIS: 'von – bis',
  ISR_KM_VON: 'km von', ISR_KM_BIS: 'km bis', ALG_LAENGE_ABSCHNITT: 'Länge (km)',
  ALG_INFRA_BETR: 'Betreiber', ALG_STAAT: 'Staat', ALG_STRECKENKLASSE: 'Streckenklasse',
  ALG_VERKEHRSART: 'Verkehrsart', ALG_TEN_KLASSIFIZIERUNG_PV: 'TEN Personenv.',
  ALG_TEN_KLASSIFIZIERUNG_GV: 'TEN Güterv.', ALG_MIN_LIRA_PROFIL: 'LiRa-Profil (min)',
  ALG_KV_PROFIL: 'KV-Profil', INF_GLEISANZAHL: 'Gleisanzahl', INF_TRAKTIONSART: 'Traktionsart',
  INF_KOMM_SYSTEM: 'Kommunikation', BET_GESCHWINDIGKEIT: 'V max (km/h)',
  BET_GESCHWINDIGKEIT_CLUSTER: 'V-Cluster', LST_PZB: 'PZB', LST_LZB: 'LZB',
  LST_ETCS_LEVEL_VERS: 'ETCS', ENE_TRAKT_STROMART: 'Stromart',
};
const ORDER = Object.keys(LABELS);

/** Popup table of a line section (HTML-escaped). */
function linePopupHtml(props: Record<string, unknown>): string {
  const rows = ORDER
    .filter((k) => props[k] != null && props[k] !== '')
    .map((k) => `<tr><td class="k">${escapeHtml(LABELS[k])}</td><td>${escapeHtml(props[k])}</td></tr>`)
    .join('');
  return `<h3>Strecke ${escapeHtml(props['ISR_STRE_NR'] ?? '?')}</h3><table>${rows}</table>`;
}

/** Extends a bbox by a (Multi)LineString geometry. */
function extendBounds(bounds: maplibregl.LngLatBounds, geom: GeoJSON.Geometry | null | undefined): void {
  if (!geom) return;
  if (geom.type === 'LineString') {
    for (const p of geom.coordinates) bounds.extend([p[0]!, p[1]!]);
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) for (const p of line) bounds.extend([p[0]!, p[1]!]);
  }
}

/** One attached line section as seen from an operating point (STEL_ID). */
export interface StationSection {
  lineNumber: string | number;
  fromTo: string;
  kmFrom: string;
  kmTo: string;
}

export class RailNetworkLayer {
  /** ISR_STRE_NR (as string) -> section features (for search and closure lines). */
  private lineIndex = new Map<string, GeoJSON.Feature[]>();
  /** STEL_ID (as string) -> attached sections (for operating-point popups). */
  private stationIndex = new Map<string, StationSection[]>();
  private mode: ColorMode = 'electrification';

  /**
   * @param onStatus status line in the panel: frac 0..1 = progress bar,
   *        null = indeterminate bar, undefined = no bar (done/error).
   */
  constructor(
    private controller: MapController,
    private onStatus: (text: string, frac?: number | null) => void,
  ) {
    const spec = {
      popupHtml: (f: MapGeoJSONFeature) => linePopupHtml(f.properties as Record<string, unknown>),
      kindLabel: () => 'Strecke',
      nearbyLabel: (f: MapGeoJSONFeature) => {
        const p = f.properties as Record<string, unknown>;
        const fromTo = p['ISR_STRECKE_VON_BIS'];
        return `Strecke ${p['ISR_STRE_NR'] ?? '?'}${fromTo ? ` · ${fromTo}` : ''}`;
      },
      dotColor: (f: MapGeoJSONFeature) => colorForProps(f.properties as Record<string, unknown>, this.mode),
    };
    controller.registerInteractive(LINE_LAYER_ID, spec);
    controller.registerInteractive(HIGHLIGHT_LAYER_ID, spec);
  }

  /** Loads the section GeoJSON, builds the indexes, and creates source + layers. */
  async load(): Promise<void> {
    this.onStatus('Lade Kartendaten …', null);
    try {
      const gj = await fetchJsonWithProgress<GeoJSON.FeatureCollection>(DATA_URL, (frac) => {
        if (frac == null) return; // indeterminate -> the animated bar stays
        this.onStatus(`Lade Kartendaten … ${Math.round(frac * 100)} %`, frac);
      });
      this.buildIndexes(gj);
      this.controller.onReady(() => {
        this.controller.addOrSetGeoJson(SOURCE_ID, gj);
        this.ensureLayers();
        this.onStatus(`${gj.features.length.toLocaleString('de-DE')} Abschnitte geladen`);
      });
    } catch (err) {
      this.onStatus(`Fehler beim Laden: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Switches the color mode (swaps the data-driven color expression). */
  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    if (this.controller.map.getLayer(LINE_LAYER_ID)) {
      this.controller.map.setPaintProperty(LINE_LAYER_ID, 'line-color', COLOR_EXPR[mode]);
    }
  }

  /**
   * Searches for a line: sets the highlight filter and zooms to the matches.
   * @returns match count (0 -> the caller reports "Strecke N nicht gefunden").
   */
  search(nr: string): number {
    const feats = this.featuresByLineNumber(nr);
    if (!feats.length) return 0;
    // Filter on the original value from the data (ISR_STRE_NR is a number there).
    const value = (feats[0]!.properties ?? {})['ISR_STRE_NR'] as string | number;
    const filter: FilterSpecification = ['==', ['get', 'ISR_STRE_NR'], value];
    if (this.controller.map.getLayer(HIGHLIGHT_LAYER_ID)) {
      this.controller.map.setFilter(HIGHLIGHT_LAYER_ID, filter);
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const f of feats) extendBounds(bounds, f.geometry);
    if (!bounds.isEmpty()) this.controller.map.fitBounds(bounds, { padding: 60 });
    return feats.length;
  }

  /** Section features per line number (input as string, e.g. "1011"). */
  featuresByLineNumber(nr: string): GeoJSON.Feature[] {
    const key = nr.trim();
    return this.lineIndex.get(key) ?? this.lineIndex.get(String(parseInt(key, 10))) ?? [];
  }

  /** Attached sections of an operating point (STEL_ID) for its popup. */
  sectionsByStation(stelId: string | number): StationSection[] {
    return this.stationIndex.get(String(stelId)) ?? [];
  }

  private buildIndexes(gj: GeoJSON.FeatureCollection): void {
    this.lineIndex.clear();
    this.stationIndex.clear();
    for (const f of gj.features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const nr = p['ISR_STRE_NR'];
      if (nr == null) continue;
      const key = String(nr);
      const list = this.lineIndex.get(key);
      if (list) list.push(f);
      else this.lineIndex.set(key, [f]);
      // Attach the section to both endpoint operating points (STEL_ID from/to).
      const seg: StationSection = {
        lineNumber: nr as string | number,
        fromTo: String(p['ISR_STRECKE_VON_BIS'] ?? ''),
        kmFrom: String(p['ISR_KM_VON'] ?? ''),
        kmTo: String(p['ISR_KM_BIS'] ?? ''),
      };
      for (const stel of [p['ISR_STEL_ID_VON'], p['ISR_STEL_ID_BIS']]) {
        if (stel == null) continue;
        const stelKey = String(stel);
        const segs = this.stationIndex.get(stelKey);
        if (segs) segs.push(seg);
        else this.stationIndex.set(stelKey, [seg]);
      }
    }
  }

  private ensureLayers(): void {
    const lineLayer: LayerSpecification = {
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': COLOR_EXPR[this.mode], 'line-width': 1.6, 'line-opacity': 0.9 },
    };
    const highlightLayer: LayerSpecification = {
      id: HIGHLIGHT_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      // Highlight nothing initially (ISR_STRE_NR is always >= 0).
      filter: ['==', ['get', 'ISR_STRE_NR'], -1],
      paint: { 'line-color': '#ff2d55', 'line-width': 3.5 },
    };
    // Insert before the trains layer so the trains render above the lines.
    this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(highlightLayer, TRAINS_LAYER_ID);
  }
}
