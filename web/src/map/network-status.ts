// Network-status overlays (disruptions/construction sites/line closures from
// strecken-info.de, server-cached via GET /api/streckeninfo): one point and one
// line layer per category; line closures additionally as a dashed line along the
// whole railway line (geometry from the section index of the RailNetworkLayer)
// plus an anchor point. Auto-refresh every 3 minutes + SSE push.
// Single responsibility: network-status overlay.
import type { ExpressionSpecification, LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import { getNetworkStatus } from '@/lib/api';
import { fmtZeitraum, tablePopupHtml } from '@/lib/format';
import type { AggregateNoticeDTO, NetworkStatusCategory, NetworkStatusResult } from '@/lib/types';
import { emptyFeatureCollection, TRAINS_LAYER_ID } from './common';
import type { MapController } from './controller';
import type { RailNetworkLayer } from './rail-network';

export type { NetworkStatusCategory } from '@/lib/types';

/** Colors of the three categories (clearly distinct from the infrastructure overlays). */
export const STATUS_COLOR: Record<NetworkStatusCategory, string> = {
  disruption: '#d23f3f',
  construction: '#f0883e',
  closure: '#8e44ad',
};

/** Auto-refresh every 3 minutes; the SSE push additionally reloads immediately. */
const REFRESH_MS = 180000;
const EVENTS_URL = '/api/streckeninfo/events';

/** Source/layer IDs per category (point and line layer share the source). */
const CATEGORY_IDS: Record<NetworkStatusCategory, { source: string; line: string; point: string }> = {
  disruption: { source: 'ns-disruptions', line: 'ns-disruptions-line', point: 'ns-disruptions-point' },
  construction: { source: 'ns-construction', line: 'ns-construction-line', point: 'ns-construction-point' },
  closure: { source: 'ns-closures', line: 'ns-closures-line', point: 'ns-closures-point' },
};

/** Counters + aggregate notices for the layer control and the panel. */
export interface NetworkStatusPanelData {
  counts: { disruptions: number; constructionSites: number; lineClosures: number };
  aggregateNotices: AggregateNoticeDTO[];
}

/**
 * queryRenderedFeatures returns nested properties as JSON STRINGS – parse
 * defensively (values coming straight from setData are still real objects).
 */
function parseMaybe<T>(v: unknown, fallback: T): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v == null ? fallback : (v as T);
}

/** Joins array values as "a, b, c"; non-arrays defensively as a string. */
function joinList(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v ? String(v) : '';
}

/** Short form of the first validity window (defensive fields, rest as "(+N)"). */
export function formatValidityShort(v: unknown): string {
  const arr = parseMaybe<unknown[]>(v, []);
  if (!Array.isArray(arr) || !arr.length) return '';
  const x = (arr[0] ?? {}) as Record<string, unknown>;
  const days = joinList(x['weekdays']);
  const from = x['startTime'] || '';
  const to = x['endTime'] || '';
  const time = from || to ? `${String(from)}–${String(to)}` : '';
  const s = [days, time].filter(Boolean).join(' ');
  return s ? s + (arr.length > 1 ? ` (+${arr.length - 1})` : '') : '';
}

/** Popup of a disruption (cause – subcause, text, effect incl. transport modes, …). */
export function disruptionPopupHtml(p: Record<string, unknown>): string {
  const effects = parseMaybe<Array<{ effect?: string; transportModes?: string[] }>>(p['effects'], []);
  const effectText = (Array.isArray(effects) ? effects : [])
    .map((w) => {
      const modes = Array.isArray(w?.transportModes) && w.transportModes.length
        ? ` (${w.transportModes.join('/')})`
        : '';
      return (w?.effect || '') + modes;
    })
    .filter(Boolean)
    .join('; ');
  const title = p['cause']
    ? String(p['cause']) + (p['subcause'] ? ` – ${String(p['subcause'])}` : '')
    : 'Störung';
  return tablePopupHtml(title, [
    ['Text', p['text']],
    ['Wirkung', effectText],
    ['Gleiseinschränkung', p['trackRestriction']],
    ['Zeitraum', fmtZeitraum(p['start'], p['end'])],
  ]);
}

/** Popup of a construction site (from→to with RIL100, lines, direction, effect, …). */
export function constructionPopupHtml(p: Record<string, unknown>): string {
  const from = [p['longNameFrom'], p['ril100From'] ? `(${p['ril100From']})` : ''].filter(Boolean).join(' ');
  const to = [p['longNameTo'], p['ril100To'] ? `(${p['ril100To']})` : ''].filter(Boolean).join(' ');
  const fromTo = from || to ? `${from} → ${to}` : '';
  const lines = joinList(parseMaybe<unknown[]>(p['lineNumbers'], []));
  return tablePopupHtml(String(p['works'] || 'Baustelle'), [
    ['von → bis', fromTo],
    ['Strecke(n)', lines],
    ['Richtung', p['direction']],
    ['Wirkung', p['effect']],
    ['Gleiseinschränkung', p['trackRestriction']],
    ['Zeitraum', fmtZeitraum(p['start'], p['end'])],
    ['Gültigkeit', formatValidityShort(p['validities'])],
  ]);
}

/** Popup of a line closure (operating point (RIL100), works, line, region, …). */
export function closurePopupHtml(p: Record<string, unknown>): string {
  const title = [p['stationLongName'], p['ril100'] ? `(${p['ril100']})` : ''].filter(Boolean).join(' ')
    || 'Streckenruhe';
  return tablePopupHtml(title, [
    ['Arbeiten', p['works']],
    ['Strecke', p['lineNumber']],
    ['Region', p['region']],
    ['Zeitraum', fmtZeitraum(p['start'], p['end'])],
    ['Gültigkeit', formatValidityShort(p['validities'])],
  ]);
}

/** The shared contract type uses its own minimal GeoJSON shape; MapLibre wants the DOM one. */
function asGeoJson(fc: unknown): GeoJSON.FeatureCollection {
  return (fc ?? emptyFeatureCollection()) as GeoJSON.FeatureCollection;
}

export class NetworkStatusLayers {
  /** Defaults as in the old frontend: disruptions on, construction/closures off. */
  private visible: Record<NetworkStatusCategory, boolean> = { disruption: true, construction: false, closure: false };
  private lastData: NetworkStatusResult | null = null;
  private layersReady = false;
  private dataReported = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private events: EventSource | null = null;

  constructor(
    private controller: MapController,
    private railNetwork: RailNetworkLayer,
    private onStatus: (text: string) => void,
    private onData: (data: NetworkStatusPanelData) => void,
  ) {
    this.registerInteractive('disruption', 'Störung', disruptionPopupHtml,
      (p) => String(p['cause'] || 'Störung'));
    this.registerInteractive('construction', 'Baustelle', constructionPopupHtml,
      (p) => String(p['works'] || 'Baustelle'));
    this.registerInteractive('closure', 'Streckenruhe', closurePopupHtml,
      (p) => String(p['stationLongName'] || 'Streckenruhe'));
  }

  /** Load immediately, then 3-min poll + SSE push (reloads right after a server refresh). */
  start(): void {
    void this.load();
    this.pollTimer = setInterval(() => void this.load(), REFRESH_MS);
    try {
      this.events = new EventSource(EVENTS_URL);
      this.events.addEventListener('streckeninfo', () => void this.load());
    } catch {
      // EventSource unavailable -> the poll is a sufficient safety net.
    }
  }

  /** Show/hide a category (point and line layer together). */
  setVisible(category: NetworkStatusCategory, on: boolean): void {
    this.visible[category] = on;
    if (!this.layersReady) return; // the desired state is applied on creation
    this.controller.setVisible(CATEGORY_IDS[category].line, on);
    this.controller.setVisible(CATEGORY_IDS[category].point, on);
  }

  /** Redraw the closure lines once the line geometry (id index) is loaded. */
  rebuildClosures(): void {
    if (!this.lastData) return;
    const fc = this.lastData.lineClosures;
    this.controller.onReady(() => {
      this.ensureLayers();
      this.applyClosures(asGeoJson(fc));
    });
  }

  /** Tear down timer/SSE (React cleanup); the controller cleans up the map. */
  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.events?.close();
    this.events = null;
  }

  private async load(): Promise<void> {
    try {
      const data = await getNetworkStatus();
      this.lastData = data;
      this.controller.onReady(() => {
        this.ensureLayers();
        this.controller.addOrSetGeoJson(CATEGORY_IDS.disruption.source, asGeoJson(data.disruptions));
        this.controller.addOrSetGeoJson(CATEGORY_IDS.construction.source, asGeoJson(data.constructionSites));
        this.applyClosures(asGeoJson(data.lineClosures));
      });
      const counts = {
        disruptions: data.counts?.disruptions ?? data.disruptions?.features?.length ?? 0,
        constructionSites: data.counts?.constructionSites ?? data.constructionSites?.features?.length ?? 0,
        lineClosures: data.counts?.lineClosures ?? data.lineClosures?.features?.length ?? 0,
      };
      this.onData({ counts, aggregateNotices: data.aggregateNotices ?? [] });
      this.dataReported = true;
      this.onStatus(data.error
        ? `Streckeninfo: ${data.error}`
        : `Streckeninfo: ${counts.disruptions} Störungen · ${counts.constructionSites} Baustellen · `
          + `${counts.lineClosures} Streckenruhen`);
    } catch (err) {
      // Report entries anyway (with 0) so the layer control stays usable;
      // data already reported by an earlier load is left untouched.
      if (!this.dataReported) {
        this.onData({ counts: { disruptions: 0, constructionSites: 0, lineClosures: 0 }, aggregateNotices: [] });
        this.dataReported = true;
      }
      this.onStatus(`Streckeninfo nicht verfügbar (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /**
   * Line closures as a LINE along the whole railway line: the API delivers only
   * one point + line number per closure, so the line geometry is pulled from the
   * section index and drawn dashed. Additionally an anchor point at the reported
   * operating point (fallback in case the line is not (yet) in the index – then
   * slightly bigger).
   */
  private applyClosures(fc: GeoJSON.FeatureCollection | undefined): void {
    const features: GeoJSON.Feature[] = [];
    for (const f of fc?.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const nr = p['lineNumber'];
      const sections = nr != null ? this.railNetwork.featuresByLineNumber(String(nr)) : [];
      let drawn = false;
      for (const seg of sections) {
        if (seg.geometry?.type !== 'LineString' && seg.geometry?.type !== 'MultiLineString') continue;
        features.push({ type: 'Feature', geometry: seg.geometry, properties: { ...p } });
        drawn = true;
      }
      if (f.geometry?.type === 'Point') {
        features.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: { ...p, anchorSmall: drawn },
        });
      }
    }
    this.controller.addOrSetGeoJson(CATEGORY_IDS.closure.source, { type: 'FeatureCollection', features });
  }

  /** Create sources + point/line layers per category (once, after style load). */
  private ensureLayers(): void {
    if (this.layersReady) return;
    for (const category of ['disruption', 'construction', 'closure'] as const) {
      this.controller.addOrSetGeoJson(CATEGORY_IDS[category].source, emptyFeatureCollection());
    }
    // SCHWER (severe) stronger than LEICHT (line width 6 instead of 4, point radius 8 instead of 6).
    const severe: ExpressionSpecification =
      ['==', ['coalesce', ['get', 'trackRestriction'], ''], 'SCHWER'];
    for (const category of ['disruption', 'construction'] as const) {
      const lineLayer: LayerSpecification = {
        id: CATEGORY_IDS[category].line,
        type: 'line',
        source: CATEGORY_IDS[category].source,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { visibility: this.visible[category] ? 'visible' : 'none' },
        paint: {
          'line-color': STATUS_COLOR[category],
          'line-width': ['case', severe, 6, 4],
          'line-opacity': 0.9,
        },
      };
      const pointLayer: LayerSpecification = {
        id: CATEGORY_IDS[category].point,
        type: 'circle',
        source: CATEGORY_IDS[category].source,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: this.visible[category] ? 'visible' : 'none' },
        paint: {
          'circle-radius': ['case', severe, 8, 6],
          'circle-color': STATUS_COLOR[category],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      };
      this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
      this.controller.addLayerOnce(pointLayer, TRAINS_LAYER_ID);
    }
    // Line closures: dashed line along the railway line + anchor point.
    const closureLine: LayerSpecification = {
      id: CATEGORY_IDS.closure.line,
      type: 'line',
      source: CATEGORY_IDS.closure.source,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: this.visible.closure ? 'visible' : 'none' },
      paint: {
        'line-color': STATUS_COLOR.closure,
        'line-width': 4,
        'line-opacity': 0.85,
        'line-dasharray': [1.5, 1.8],
      },
    };
    const closurePoint: LayerSpecification = {
      id: CATEGORY_IDS.closure.point,
      type: 'circle',
      source: CATEGORY_IDS.closure.source,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: this.visible.closure ? 'visible' : 'none' },
      paint: {
        // Anchor point slightly smaller once the line itself is drawn dashed.
        'circle-radius': ['case', ['boolean', ['get', 'anchorSmall'], false], 5, 6],
        'circle-color': STATUS_COLOR.closure,
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    };
    this.controller.addLayerOnce(closureLine, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(closurePoint, TRAINS_LAYER_ID);
    this.layersReady = true;
  }

  /** Point and line layer of a category share the same interactive spec. */
  private registerInteractive(
    category: NetworkStatusCategory,
    kind: string,
    popup: (p: Record<string, unknown>) => string,
    label: (p: Record<string, unknown>) => string,
  ): void {
    const spec = {
      popupHtml: (f: MapGeoJSONFeature) => popup(f.properties as Record<string, unknown>),
      kindLabel: () => kind,
      nearbyLabel: (f: MapGeoJSONFeature) => label(f.properties as Record<string, unknown>),
      dotColor: () => STATUS_COLOR[category],
    };
    this.controller.registerInteractive(CATEGORY_IDS[category].line, spec);
    this.controller.registerInteractive(CATEGORY_IDS[category].point, spec);
  }
}
