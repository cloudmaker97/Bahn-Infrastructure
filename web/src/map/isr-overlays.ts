// ISR-Infrastruktur-Overlays (statische GeoJSON-Dateien aus /data): Übergangsstellen,
// Betriebsstellen, Tunnel, Brücken und Bahnübergänge. Alle standardmäßig aus; die
// Daten werden parallel geladen (Zähler für die Ebenen-Steuerung), Karten-Layer
// entstehen erst bei der ersten Aktivierung. Eine Verantwortung: ISR-Overlays.
import type { LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import { getGeoJson } from '@/lib/api';
import { escapeHtml, tablePopupHtml } from '@/lib/format';
import type { MapController } from './controller';
import type { StreckenLayer } from './strecken';

export type OverlayKey = 'uebergaenge' | 'betriebsstellen' | 'tunnel' | 'bruecken' | 'bahnuebergaenge';

/** Vor den Zug-Layer einfügen, damit die Züge über den Overlays liegen. */
const TRAINS_LAYER_ID = 'trains';

const sourceId = (key: OverlayKey): string => `ov-${key}`;
const layerId = (key: OverlayKey): string => `ov-${key}`;

/**
 * Betriebsstellen-Popup: Basisdaten + Liste der zugehörigen Strecken/Abschnitte
 * (Lookup über den STEL-Index des StreckenLayer).
 */
function bstPopupHtml(p: Record<string, unknown>, strecken: StreckenLayer): string {
  const base = tablePopupHtml('Betriebsstelle', [
    ['Name', p['BST_STELLE_NAME']],
    ['RL100', p['BST_RL100']],
    ['km', p['LAGE_KM_V']],
    ['TAF/TAP', p['BST_TAF_TAP_PC']],
    ['Art', p['BST_STELLENART']],
  ]);
  const list = p['STEL_ID'] != null ? strecken.abschnitteByStel(String(p['STEL_ID'])) : [];
  if (!list.length) return base;
  const rows = list.map((a) =>
    `<tr><td class="k">${escapeHtml(a.nr)}</td><td>${escapeHtml(a.vonBis)}</td>` +
    `<td>${escapeHtml(a.kmVon)} → ${escapeHtml(a.kmBis)}</td></tr>`).join('');
  return base +
    `<div style="margin-top:8px;font-size:11px;color:var(--muted);text-transform:uppercase;` +
    `letter-spacing:.04em;font-weight:600">Zugehörige Strecken/Abschnitte (${list.length})</div>` +
    `<div style="max-height:180px;overflow:auto"><table>${rows}</table></div>`;
}

/** Beschreibung eines Overlays (Datei, Optik, Popup, Nearby-Infos). */
interface OverlayDef {
  key: OverlayKey;
  file: string;
  /** Beschriftung in der Ebenen-Steuerung. */
  label: string;
  /** Typ-Beschriftung für die Nearby-Auswahlliste. */
  kind: string;
  art: 'punkt' | 'linie';
  farbe: string;
  /** Punktradius (nur art 'punkt'). */
  radius?: number;
  popupHtml(p: Record<string, unknown>, strecken: StreckenLayer): string;
  nearbyLabel(p: Record<string, unknown>): string;
}

/** Die fünf Overlays in Anzeige-Reihenfolge (Feld-Labels wie im Alt-Frontend). */
const DEFS: readonly OverlayDef[] = [
  {
    key: 'uebergaenge', file: 'map_streckenuebergaenge.geojson',
    label: 'Übergangsstellen', kind: 'Übergangsstelle', art: 'punkt', farbe: '#ffd23f', radius: 3.5,
    popupHtml: (p) => tablePopupHtml('Übergangsstelle', [
      ['Name', p['BST_STELLE_NAME']], ['Strecke 1', p['STRECKE1']], ['Strecke 2', p['STRECKE2']],
      ['RL100', p['REF_RL100']], ['Stellenart', p['BST_STELLENART']],
    ]),
    nearbyLabel: (p) => String(p['BST_STELLE_NAME'] || 'Übergang'),
  },
  {
    key: 'betriebsstellen', file: 'map_betriebsstellen.geojson',
    label: 'Betriebsstellen', kind: 'Betriebsstelle', art: 'punkt', farbe: '#4aa3ff', radius: 3,
    popupHtml: bstPopupHtml,
    nearbyLabel: (p) => String(p['BST_STELLE_NAME'] || 'Betriebsstelle'),
  },
  {
    key: 'tunnel', file: 'map_tunnel.geojson',
    label: 'Tunnel', kind: 'Tunnel', art: 'linie', farbe: '#b06be8',
    popupHtml: (p) => tablePopupHtml(`Tunnel: ${p['ALG_TUNNELNAME'] ?? ''}`, [
      ['Strecke', p['DET_STR_NR']], ['Länge (m)', p['ALG_TUNNELLAENGE']], ['Art', p['ALG_TUNNELART']],
      ['TSI-konf.', p['ALG_TSI_KONF']], ['Notausgang', p['ALG_TUNN_NOTAUS_KZ']],
    ]),
    nearbyLabel: (p) => String(p['ALG_TUNNELNAME'] || 'Tunnel'),
  },
  {
    key: 'bruecken', file: 'map_bruecken.geojson',
    label: 'Brücken', kind: 'Brücke', art: 'linie', farbe: '#2ec76b',
    popupHtml: (p) => tablePopupHtml(`Brücke: ${p['ALG_BRUECKENNAME'] ?? ''}`, [
      ['Strecke', p['DET_STR_NR']], ['Länge (m)', p['ALG_BRUECKENLAENGE']],
      ['km von', p['KMVON_V']], ['km bis', p['KMBIS_V']],
    ]),
    nearbyLabel: (p) => String(p['ALG_BRUECKENNAME'] || 'Brücke'),
  },
  {
    key: 'bahnuebergaenge', file: 'map_bahnuebergaenge.geojson',
    label: 'Bahnübergänge', kind: 'Bahnübergang', art: 'punkt', farbe: '#ff7043', radius: 2.5,
    popupHtml: (p) => tablePopupHtml(`Bahnübergang: ${p['ALG_BAHNUEBERGANGNAME'] ?? ''}`, [
      ['Strecke', p['ALG_DBNETZ_STRECKE']], ['Sicherungsart', p['ALG_SICHERUNGSART']],
      ['Kreuzungspartner', p['ALG_KREUZUNGSPARTNER']],
    ]),
    nearbyLabel: (p) => String(p['ALG_BAHNUEBERGANGNAME'] || 'Bahnübergang'),
  },
];

/** Reihenfolge + Beschriftungen für die Ebenen-Steuerung (ohne Karten-Abhängigkeit). */
export const OVERLAY_EINTRAEGE: ReadonlyArray<{ key: OverlayKey; label: string }> =
  DEFS.map((d) => ({ key: d.key, label: d.label }));

export class IsrOverlays {
  /** Geladene FeatureCollections je Overlay (Basis für Zähler + Layer). */
  private data = new Map<OverlayKey, GeoJSON.FeatureCollection>();
  /** Gewünschte Sichtbarkeit (auch merkbar, bevor die Daten da sind). */
  private visible = new Map<OverlayKey, boolean>();
  private added = new Set<OverlayKey>();

  constructor(
    private controller: MapController,
    private strecken: StreckenLayer,
    private onCount: (key: OverlayKey, count: number) => void,
  ) {
    for (const def of DEFS) {
      controller.registerInteractive(layerId(def.key), {
        popupHtml: (f: MapGeoJSONFeature) =>
          def.popupHtml(f.properties as Record<string, unknown>, this.strecken),
        kindLabel: () => def.kind,
        nearbyLabel: (f: MapGeoJSONFeature) => def.nearbyLabel(f.properties as Record<string, unknown>),
        dotColor: () => def.farbe,
      });
    }
  }

  /** Alle fünf Dateien parallel laden; Fehler einzelner Dateien -> kein Eintrag. */
  loadAll(): void {
    for (const def of DEFS) {
      getGeoJson(`/data/${def.file}`)
        .then((gj) => {
          this.data.set(def.key, gj);
          this.onCount(def.key, gj.features.length);
          // Falls das Overlay schon aktiviert wurde, den Layer jetzt nachziehen.
          if (this.visible.get(def.key)) {
            this.controller.onReady(() => this.ensureLayer(def));
          }
        })
        .catch(() => { /* Overlay ohne Daten bleibt ohne Eintrag (wie im Alt-Frontend) */ });
    }
  }

  /** Overlay ein-/ausblenden; der Karten-Layer entsteht erst bei der Aktivierung. */
  setVisible(key: OverlayKey, on: boolean): void {
    this.visible.set(key, on);
    const def = DEFS.find((d) => d.key === key);
    if (!def) return;
    this.controller.onReady(() => {
      if (on && !this.added.has(key)) this.ensureLayer(def);
      this.controller.setVisible(layerId(key), on);
    });
  }

  private ensureLayer(def: OverlayDef): void {
    const gj = this.data.get(def.key);
    if (!gj || this.added.has(def.key)) return;
    this.controller.addOrSetGeoJson(sourceId(def.key), gj);
    const layer: LayerSpecification = def.art === 'punkt'
      ? {
          id: layerId(def.key),
          type: 'circle',
          source: sourceId(def.key),
          paint: {
            'circle-radius': def.radius ?? 3,
            'circle-color': def.farbe,
            'circle-opacity': 0.9,
            'circle-stroke-color': '#111111',
            'circle-stroke-width': 1,
          },
        }
      : {
          id: layerId(def.key),
          type: 'line',
          source: sourceId(def.key),
          paint: { 'line-color': def.farbe, 'line-width': 4, 'line-opacity': 0.9 },
        };
    this.controller.addLayerOnce(layer, TRAINS_LAYER_ID);
    this.added.add(def.key);
  }
}
