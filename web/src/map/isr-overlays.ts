// ISR infrastructure overlays (static GeoJSON files from /data): transition
// points, operating points, tunnels, bridges, and level crossings. All off by
// default; the data loads in parallel (counters for the layer control), map
// layers are created on first activation. Single responsibility: ISR overlays.
import type { LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import { getGeoJson } from '@/lib/api';
import { escapeHtml, tablePopupHtml } from '@/lib/format';
import { TRAINS_LAYER_ID } from './common';
import type { MapController } from './controller';
import type { RailNetworkLayer } from './rail-network';

export type OverlayKey = 'transition-points' | 'stations' | 'tunnels' | 'bridges' | 'level-crossings';

const sourceId = (key: OverlayKey): string => `ov-${key}`;
const layerId = (key: OverlayKey): string => `ov-${key}`;

/**
 * Operating-point popup: base data + list of the attached lines/sections
 * (lookup via the station index of the RailNetworkLayer).
 */
function stationPopupHtml(p: Record<string, unknown>, railNetwork: RailNetworkLayer): string {
  const base = tablePopupHtml('Betriebsstelle', [
    ['Name', p['BST_STELLE_NAME']],
    ['RL100', p['BST_RL100']],
    ['km', p['LAGE_KM_V']],
    ['TAF/TAP', p['BST_TAF_TAP_PC']],
    ['Art', p['BST_STELLENART']],
  ]);
  const list = p['STEL_ID'] != null ? railNetwork.sectionsByStation(String(p['STEL_ID'])) : [];
  if (!list.length) return base;
  const rows = list.map((a) =>
    `<tr><td class="k">${escapeHtml(a.lineNumber)}</td><td>${escapeHtml(a.fromTo)}</td>` +
    `<td>${escapeHtml(a.kmFrom)} → ${escapeHtml(a.kmTo)}</td></tr>`).join('');
  // No scroll container of its own: the popup content already scrolls
  // (max-height in globals.css) and nested scrollbars are bad UX.
  return base +
    `<div style="margin-top:8px;font-size:11px;color:var(--muted);text-transform:uppercase;` +
    `letter-spacing:.04em;font-weight:600">Zugehörige Strecken/Abschnitte (${list.length})</div>` +
    `<table>${rows}</table>`;
}

/** Description of one overlay (file, look, popup, nearby info). */
interface OverlayDef {
  key: OverlayKey;
  /** On-disk artifact name (persisted format – stays as generated). */
  file: string;
  /** Caption in the layer control (German UI text). */
  label: string;
  /** Kind caption for the nearby selection list (German UI text). */
  kind: string;
  geomType: 'point' | 'line';
  color: string;
  /** Circle radius (geomType 'point' only). */
  radius?: number;
  popupHtml(p: Record<string, unknown>, railNetwork: RailNetworkLayer): string;
  nearbyLabel(p: Record<string, unknown>): string;
}

/** The five overlays in display order (field labels as in the old frontend). */
const DEFS: readonly OverlayDef[] = [
  {
    key: 'transition-points', file: 'map_streckenuebergaenge.geojson',
    label: 'Übergangsstellen', kind: 'Übergangsstelle', geomType: 'point', color: '#ffd23f', radius: 3.5,
    popupHtml: (p) => tablePopupHtml('Übergangsstelle', [
      ['Name', p['BST_STELLE_NAME']], ['Strecke 1', p['STRECKE1']], ['Strecke 2', p['STRECKE2']],
      ['RL100', p['REF_RL100']], ['Stellenart', p['BST_STELLENART']],
    ]),
    nearbyLabel: (p) => String(p['BST_STELLE_NAME'] || 'Übergang'),
  },
  {
    key: 'stations', file: 'map_betriebsstellen.geojson',
    label: 'Betriebsstellen', kind: 'Betriebsstelle', geomType: 'point', color: '#4aa3ff', radius: 3,
    popupHtml: stationPopupHtml,
    nearbyLabel: (p) => String(p['BST_STELLE_NAME'] || 'Betriebsstelle'),
  },
  {
    key: 'tunnels', file: 'map_tunnel.geojson',
    label: 'Tunnel', kind: 'Tunnel', geomType: 'line', color: '#b06be8',
    popupHtml: (p) => tablePopupHtml(`Tunnel: ${p['ALG_TUNNELNAME'] ?? ''}`, [
      ['Strecke', p['DET_STR_NR']], ['Länge (m)', p['ALG_TUNNELLAENGE']], ['Art', p['ALG_TUNNELART']],
      ['TSI-konf.', p['ALG_TSI_KONF']], ['Notausgang', p['ALG_TUNN_NOTAUS_KZ']],
    ]),
    nearbyLabel: (p) => String(p['ALG_TUNNELNAME'] || 'Tunnel'),
  },
  {
    key: 'bridges', file: 'map_bruecken.geojson',
    label: 'Brücken', kind: 'Brücke', geomType: 'line', color: '#2ec76b',
    popupHtml: (p) => tablePopupHtml(`Brücke: ${p['ALG_BRUECKENNAME'] ?? ''}`, [
      ['Strecke', p['DET_STR_NR']], ['Länge (m)', p['ALG_BRUECKENLAENGE']],
      ['km von', p['KMVON_V']], ['km bis', p['KMBIS_V']],
    ]),
    nearbyLabel: (p) => String(p['ALG_BRUECKENNAME'] || 'Brücke'),
  },
  {
    key: 'level-crossings', file: 'map_bahnuebergaenge.geojson',
    label: 'Bahnübergänge', kind: 'Bahnübergang', geomType: 'point', color: '#ff7043', radius: 2.5,
    popupHtml: (p) => tablePopupHtml(`Bahnübergang: ${p['ALG_BAHNUEBERGANGNAME'] ?? ''}`, [
      ['Strecke', p['ALG_DBNETZ_STRECKE']], ['Sicherungsart', p['ALG_SICHERUNGSART']],
      ['Kreuzungspartner', p['ALG_KREUZUNGSPARTNER']],
    ]),
    nearbyLabel: (p) => String(p['ALG_BAHNUEBERGANGNAME'] || 'Bahnübergang'),
  },
];

/** Order + captions for the layer control (without a map dependency). */
export const OVERLAY_ENTRIES: ReadonlyArray<{ key: OverlayKey; label: string }> =
  DEFS.map((d) => ({ key: d.key, label: d.label }));

export class IsrOverlays {
  /** Loaded FeatureCollections per overlay (basis for counters + layers). */
  private data = new Map<OverlayKey, GeoJSON.FeatureCollection>();
  /** Desired visibility (also remembered before the data has arrived). */
  private visible = new Map<OverlayKey, boolean>();
  private added = new Set<OverlayKey>();

  constructor(
    private controller: MapController,
    private railNetwork: RailNetworkLayer,
    private onCount: (key: OverlayKey, count: number) => void,
  ) {
    for (const def of DEFS) {
      controller.registerInteractive(layerId(def.key), {
        popupHtml: (f: MapGeoJSONFeature) =>
          def.popupHtml(f.properties as Record<string, unknown>, this.railNetwork),
        kindLabel: () => def.kind,
        nearbyLabel: (f: MapGeoJSONFeature) => def.nearbyLabel(f.properties as Record<string, unknown>),
        dotColor: () => def.color,
      });
    }
  }

  /** Loads all five files in parallel; a failing file -> no entry. */
  loadAll(): void {
    for (const def of DEFS) {
      getGeoJson(`/data/${def.file}`)
        .then((gj) => {
          this.data.set(def.key, gj);
          this.onCount(def.key, gj.features.length);
          // When the overlay was already activated, create the layer now.
          if (this.visible.get(def.key)) {
            this.controller.onReady(() => this.ensureLayer(def));
          }
        })
        .catch(() => { /* an overlay without data stays without an entry (as in the old frontend) */ });
    }
  }

  /** Shows/hides an overlay; the map layer is created on first activation. */
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
    const layer: LayerSpecification = def.geomType === 'point'
      ? {
          id: layerId(def.key),
          type: 'circle',
          source: sourceId(def.key),
          paint: {
            'circle-radius': def.radius ?? 3,
            'circle-color': def.color,
            'circle-opacity': 0.9,
            'circle-stroke-color': '#111111',
            'circle-stroke-width': 1,
          },
        }
      : {
          id: layerId(def.key),
          type: 'line',
          source: sourceId(def.key),
          paint: { 'line-color': def.color, 'line-width': 4, 'line-opacity': 0.9 },
        };
    this.controller.addLayerOnce(layer, TRAINS_LAYER_ID);
    this.added.add(def.key);
  }
}
