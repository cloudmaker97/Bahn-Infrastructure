// Streckennetz-Layer: lädt die (große) Abschnitts-GeoJSON mit Streaming-Fortschritt,
// baut die Indizes (Streckennummer, Betriebsstellen-ID) und färbt die Linien je
// Einfärbungsmodus über datengetriebene Farb-Expressions. Eine Verantwortung: Strecken.
import maplibregl from 'maplibre-gl';
import type {
  DataDrivenPropertyValueSpecification, ExpressionSpecification, FilterSpecification,
  LayerSpecification, MapGeoJSONFeature,
} from 'maplibre-gl';
import { fetchJsonWithProgress } from '@/lib/api';
import { escapeHtml } from '@/lib/format';
import type { MapController } from './controller';

export type ColorMode = 'elektr' | 'speed' | 'gleis' | 'uniform';

/** Grau für „keine Angabe" (auch von der Legende im SidePanel genutzt). */
export const GRAU = '#8894a0';

const DATA_URL = '/data/map_streckenabschnitte.geojson';
const SOURCE_ID = 'strecken';
const LINE_LAYER_ID = 'strecken-line';
const HIGHLIGHT_LAYER_ID = 'strecken-highlight';
/** Live-Züge sollen über den Strecken liegen -> Strecken-Layer davor einfügen. */
const TRAINS_LAYER_ID = 'trains';

// V max als Zahl; -1 als Fallback für nicht-numerische Strings (z. B. „k. A.").
const SPEED_NUM: ExpressionSpecification = ['to-number', ['get', 'BET_GESCHWINDIGKEIT'], -1];

/** Datengetriebene Linienfarbe je Einfärbungsmodus (Farbwerte wie im Alt-Frontend). */
const COLOR_EXPR: Record<ColorMode, DataDrivenPropertyValueSpecification<string>> = {
  elektr: [
    'match', ['get', 'INF_TRAKTIONSART'],
    'Oberleitung', '#2f7fe0',
    'Stromschiene', '#9b59d0',
    'nicht elektrifiziert', '#e8863b',
    GRAU,
  ],
  gleis: [
    'match', ['get', 'INF_GLEISANZAHL'],
    'eingleisig', '#e8863b',
    'Richtungsgleis', '#2f7fe0',
    'Gegengleis', '#38b48b',
    GRAU,
  ],
  speed: [
    'case',
    // Fehlend/leer -> grau ("to-number" würde null/'' sonst zu 0 machen, nicht zu -1).
    ['!', ['has', 'BET_GESCHWINDIGKEIT']], GRAU,
    ['==', ['get', 'BET_GESCHWINDIGKEIT'], ''], GRAU,
    ['<', SPEED_NUM, 0], GRAU,
    ['step', SPEED_NUM, '#3d9970', 80, '#7bbf4a', 100, '#e8c135', 120, '#f0883e', 160, '#e34a6f', 230, '#c0245e'],
  ],
  uniform: '#2f7fe0',
};

/** Feldbeschriftungen des Strecken-Popups (Reihenfolge = Anzeige-Reihenfolge). */
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

/**
 * Farbe eines Abschnitts für Nicht-Expression-Kontexte (Farbpunkt der
 * Nearby-Auswahlliste); spiegelt bewusst die Logik von COLOR_EXPR.
 */
export function colorForProps(p: Record<string, unknown>, mode: ColorMode): string {
  if (mode === 'uniform') return '#2f7fe0';
  if (mode === 'speed') {
    const s = parseInt(String(p['BET_GESCHWINDIGKEIT'] ?? ''), 10);
    if (Number.isNaN(s)) return GRAU;
    if (s >= 230) return '#c0245e';
    if (s >= 160) return '#e34a6f';
    if (s >= 120) return '#f0883e';
    if (s >= 100) return '#e8c135';
    if (s >= 80) return '#7bbf4a';
    return '#3d9970';
  }
  const tabelle: Record<string, string> = mode === 'gleis'
    ? { eingleisig: '#e8863b', Richtungsgleis: '#2f7fe0', Gegengleis: '#38b48b' }
    : { Oberleitung: '#2f7fe0', Stromschiene: '#9b59d0', 'nicht elektrifiziert': '#e8863b' };
  const wert = String(p[mode === 'gleis' ? 'INF_GLEISANZAHL' : 'INF_TRAKTIONSART'] ?? '');
  return tabelle[wert] ?? GRAU;
}

/** Popup-Tabelle eines Streckenabschnitts (HTML-escaped). */
function streckenPopupHtml(props: Record<string, unknown>): string {
  const rows = ORDER
    .filter((k) => props[k] != null && props[k] !== '')
    .map((k) => `<tr><td class="k">${escapeHtml(LABELS[k])}</td><td>${escapeHtml(props[k])}</td></tr>`)
    .join('');
  return `<h3>Strecke ${escapeHtml(props['ISR_STRE_NR'] ?? '?')}</h3><table>${rows}</table>`;
}

/** Bbox um eine (Multi)LineString-Geometrie erweitern. */
function extendBounds(bounds: maplibregl.LngLatBounds, geom: GeoJSON.Geometry | null | undefined): void {
  if (!geom) return;
  if (geom.type === 'LineString') {
    for (const p of geom.coordinates) bounds.extend([p[0]!, p[1]!]);
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) for (const p of line) bounds.extend([p[0]!, p[1]!]);
  }
}

/** Ein zugehöriger Streckenabschnitt aus Sicht einer Betriebsstelle (STEL_ID). */
export interface StelAbschnitt {
  nr: string | number;
  vonBis: string;
  kmVon: string;
  kmBis: string;
}

export class StreckenLayer {
  /** ISR_STRE_NR (als String) -> Abschnitts-Features (für Suche und Ruhen-Linien). */
  private idIndex = new Map<string, GeoJSON.Feature[]>();
  /** STEL_ID (als String) -> zugehörige Abschnitte (für Betriebsstellen-Popups). */
  private stelIndex = new Map<string, StelAbschnitt[]>();
  private mode: ColorMode = 'elektr';

  /**
   * @param onStatus Statuszeile im Panel: frac 0..1 = Fortschrittsbalken,
   *        null = unbestimmter Balken, undefined = kein Balken (fertig/Fehler).
   */
  constructor(
    private controller: MapController,
    private onStatus: (text: string, frac?: number | null) => void,
  ) {
    const spec = {
      popupHtml: (f: MapGeoJSONFeature) => streckenPopupHtml(f.properties as Record<string, unknown>),
      kindLabel: () => 'Strecke',
      nearbyLabel: (f: MapGeoJSONFeature) => {
        const p = f.properties as Record<string, unknown>;
        const vonBis = p['ISR_STRECKE_VON_BIS'];
        return `Strecke ${p['ISR_STRE_NR'] ?? '?'}${vonBis ? ` · ${vonBis}` : ''}`;
      },
      dotColor: (f: MapGeoJSONFeature) => colorForProps(f.properties as Record<string, unknown>, this.mode),
    };
    controller.registerInteractive(LINE_LAYER_ID, spec);
    controller.registerInteractive(HIGHLIGHT_LAYER_ID, spec);
  }

  /** Lädt die Abschnitts-GeoJSON, baut die Indizes und legt Source + Layer an. */
  async load(): Promise<void> {
    this.onStatus('Lade Kartendaten …', null);
    try {
      const gj = await fetchJsonWithProgress<GeoJSON.FeatureCollection>(DATA_URL, (frac) => {
        if (frac == null) return; // unbestimmt -> animierter Balken bleibt
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

  /** Einfärbungsmodus wechseln (datengetriebene Farb-Expression austauschen). */
  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    if (this.controller.map.getLayer(LINE_LAYER_ID)) {
      this.controller.map.setPaintProperty(LINE_LAYER_ID, 'line-color', COLOR_EXPR[mode]);
    }
  }

  /**
   * Strecke suchen: Highlight-Filter setzen und auf die Treffer zoomen.
   * @returns Trefferzahl (0 -> Aufrufer meldet „Strecke N nicht gefunden").
   */
  search(nr: string): number {
    const feats = this.featuresByNr(nr);
    if (!feats.length) return 0;
    // Filter auf den Original-Wert aus den Daten (ISR_STRE_NR ist dort eine Zahl).
    const wert = (feats[0]!.properties ?? {})['ISR_STRE_NR'] as string | number;
    const filter: FilterSpecification = ['==', ['get', 'ISR_STRE_NR'], wert];
    if (this.controller.map.getLayer(HIGHLIGHT_LAYER_ID)) {
      this.controller.map.setFilter(HIGHLIGHT_LAYER_ID, filter);
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const f of feats) extendBounds(bounds, f.geometry);
    if (!bounds.isEmpty()) this.controller.map.fitBounds(bounds, { padding: 60 });
    return feats.length;
  }

  /** Abschnitts-Features je Streckennummer (Eingabe als String, z. B. „1011"). */
  featuresByNr(nr: string): GeoJSON.Feature[] {
    const key = nr.trim();
    return this.idIndex.get(key) ?? this.idIndex.get(String(parseInt(key, 10))) ?? [];
  }

  /** Zugehörige Abschnitte einer Betriebsstelle (STEL_ID) für deren Popup. */
  abschnitteByStel(stelId: string | number): StelAbschnitt[] {
    return this.stelIndex.get(String(stelId)) ?? [];
  }

  private buildIndexes(gj: GeoJSON.FeatureCollection): void {
    this.idIndex.clear();
    this.stelIndex.clear();
    for (const f of gj.features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const nr = p['ISR_STRE_NR'];
      if (nr == null) continue;
      const key = String(nr);
      const list = this.idIndex.get(key);
      if (list) list.push(f);
      else this.idIndex.set(key, [f]);
      // Abschnitt beiden Endpunkt-Betriebsstellen zuordnen (STEL_ID von/bis).
      const seg: StelAbschnitt = {
        nr: nr as string | number,
        vonBis: String(p['ISR_STRECKE_VON_BIS'] ?? ''),
        kmVon: String(p['ISR_KM_VON'] ?? ''),
        kmBis: String(p['ISR_KM_BIS'] ?? ''),
      };
      for (const stel of [p['ISR_STEL_ID_VON'], p['ISR_STEL_ID_BIS']]) {
        if (stel == null) continue;
        const stelKey = String(stel);
        const segs = this.stelIndex.get(stelKey);
        if (segs) segs.push(seg);
        else this.stelIndex.set(stelKey, [seg]);
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
      // Initial nichts hervorheben (ISR_STRE_NR ist immer >= 0).
      filter: ['==', ['get', 'ISR_STRE_NR'], -1],
      paint: { 'line-color': '#ff2d55', 'line-width': 3.5 },
    };
    // Vor den Zug-Layer einfügen, damit die Züge über den Strecken liegen.
    this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(highlightLayer, TRAINS_LAYER_ID);
  }
}
