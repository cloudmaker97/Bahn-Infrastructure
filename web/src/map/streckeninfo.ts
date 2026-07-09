// Streckeninfo-Overlays (Störungen/Baustellen/Streckenruhen von strecken-info.de,
// server-gecacht über GET /api/streckeninfo): je Kategorie ein Punkt- und ein
// Linien-Layer; Streckenruhen zusätzlich als gestrichelte Linie entlang der ganzen
// Strecke (Geometrie aus dem Abschnitts-Index des StreckenLayer) plus Ankerpunkt.
// Auto-Refresh alle 3 Minuten + SSE-Push. Eine Verantwortung: Streckeninfo-Overlay.
import type { ExpressionSpecification, LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import { getStreckenInfo } from '@/lib/api';
import { fmtZeitraum, tablePopupHtml } from '@/lib/format';
import type { SammelmeldungDTO, StreckenInfoResult } from '@/lib/types';
import type { MapController } from './controller';
import type { StreckenLayer } from './strecken';

export type SiKategorie = 'stoerung' | 'baustelle' | 'ruhe';

/** Farben der drei Kategorien (klar abgesetzt von den Infrastruktur-Overlays). */
export const SI_COLOR: Record<SiKategorie, string> = {
  stoerung: '#d23f3f',
  baustelle: '#f0883e',
  ruhe: '#8e44ad',
};

/** Auto-Refresh alle 3 Minuten; der SSE-Push lädt zusätzlich sofort nach. */
const REFRESH_MS = 180000;
const EVENTS_URL = '/api/streckeninfo/events';
/** Vor den Zug-Layer einfügen, damit die Züge über den Meldungen liegen. */
const TRAINS_LAYER_ID = 'trains';

/** Source-/Layer-IDs je Kategorie (Punkt- und Linien-Layer teilen die Source). */
const KAT: Record<SiKategorie, { source: string; line: string; point: string }> = {
  stoerung: { source: 'si-stoerungen', line: 'si-stoerungen-line', point: 'si-stoerungen-point' },
  baustelle: { source: 'si-baustellen', line: 'si-baustellen-line', point: 'si-baustellen-point' },
  ruhe: { source: 'si-ruhen', line: 'si-ruhen-line', point: 'si-ruhen-point' },
};

/** Zähler + Sammelmeldungen für Ebenen-Steuerung und Panel. */
export interface SiPanelDaten {
  counts: { stoerungen: number; baustellen: number; streckenruhen: number };
  sammelmeldungen: SammelmeldungDTO[];
}

/**
 * queryRenderedFeatures liefert verschachtelte properties als JSON-STRINGS –
 * defensiv parsen (direkt aus setData stammende Werte sind noch echte Objekte).
 */
function parseMaybe<T>(v: unknown, fallback: T): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v == null ? fallback : (v as T);
}

/** Array-Werte zu „a, b, c" verbinden; Nicht-Arrays defensiv als String. */
function joinListe(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v ? String(v) : '';
}

/** Kurzform der ersten Gültigkeit (Felder defensiv, Rest als „(+N)"). */
export function gueltigkeitKurz(g: unknown): string {
  const arr = parseMaybe<unknown[]>(g, []);
  if (!Array.isArray(arr) || !arr.length) return '';
  const x = (arr[0] ?? {}) as Record<string, unknown>;
  const tage = joinListe(x['wochentage']) || joinListe(x['tage']);
  const von = x['von'] || x['uhrzeitVon'] || x['zeitVon'] || x['beginn'] || '';
  const bis = x['bis'] || x['uhrzeitBis'] || x['zeitBis'] || x['ende'] || '';
  const zeit = von || bis ? `${String(von)}–${String(bis)}` : '';
  const s = [tage, zeit].filter(Boolean).join(' ');
  return s ? s + (arr.length > 1 ? ` (+${arr.length - 1})` : '') : '';
}

/** Popup einer Störung (cause – subcause, Text, Wirkung inkl. Verkehrsarten, …). */
export function stoerungPopupHtml(p: Record<string, unknown>): string {
  const wirkungen = parseMaybe<Array<{ wirkung?: string; verkehrsarten?: string[] }>>(p['wirkungen'], []);
  const wirkung = (Array.isArray(wirkungen) ? wirkungen : [])
    .map((w) => {
      const va = Array.isArray(w?.verkehrsarten) && w.verkehrsarten.length
        ? ` (${w.verkehrsarten.join('/')})`
        : '';
      return (w?.wirkung || '') + va;
    })
    .filter(Boolean)
    .join('; ');
  const titel = p['cause']
    ? String(p['cause']) + (p['subcause'] ? ` – ${String(p['subcause'])}` : '')
    : 'Störung';
  return tablePopupHtml(titel, [
    ['Text', p['text']],
    ['Wirkung', wirkung],
    ['Gleiseinschränkung', p['gleisEinschraenkung']],
    ['Zeitraum', fmtZeitraum(p['beginn'], p['ende'])],
  ]);
}

/** Popup einer Baustelle (von→bis mit RIL100, Strecken, Richtung, Wirkung, …). */
export function baustellePopupHtml(p: Record<string, unknown>): string {
  const von = [p['langnameVon'], p['ril100Von'] ? `(${p['ril100Von']})` : ''].filter(Boolean).join(' ');
  const bis = [p['langnameBis'], p['ril100Bis'] ? `(${p['ril100Bis']})` : ''].filter(Boolean).join(' ');
  const vonBis = von || bis ? `${von} → ${bis}` : '';
  const strecken = joinListe(parseMaybe<unknown[]>(p['streckennummern'], []));
  return tablePopupHtml(String(p['arbeiten'] || 'Baustelle'), [
    ['von → bis', vonBis],
    ['Strecke(n)', strecken],
    ['Richtung', p['richtung']],
    ['Wirkung', p['wirkung']],
    ['Gleiseinschränkung', p['gleisEinschraenkung']],
    ['Zeitraum', fmtZeitraum(p['beginn'], p['ende'])],
    ['Gültigkeit', gueltigkeitKurz(p['gueltigkeiten'])],
  ]);
}

/** Popup einer Streckenruhe (BSt (RIL100), Arbeiten, Strecke, Region, …). */
export function ruhePopupHtml(p: Record<string, unknown>): string {
  const titel = [p['bstLangname'], p['ril100'] ? `(${p['ril100']})` : ''].filter(Boolean).join(' ')
    || 'Streckenruhe';
  return tablePopupHtml(titel, [
    ['Arbeiten', p['arbeiten']],
    ['Strecke', p['streckennummer']],
    ['Region', p['region']],
    ['Zeitraum', fmtZeitraum(p['beginn'], p['ende'])],
    ['Gültigkeit', gueltigkeitKurz(p['gueltigkeiten'])],
  ]);
}

/** Leere FeatureCollection (Initialdaten der Sources). */
function leer(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

export class StreckenInfoLayers {
  /** Standard wie im Alt-Frontend: Störungen an, Baustellen/Streckenruhen aus. */
  private visible: Record<SiKategorie, boolean> = { stoerung: true, baustelle: false, ruhe: false };
  private lastData: StreckenInfoResult | null = null;
  private layersReady = false;
  private datenGemeldet = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private events: EventSource | null = null;

  constructor(
    private controller: MapController,
    private strecken: StreckenLayer,
    private onStatus: (text: string) => void,
    private onDaten: (daten: SiPanelDaten) => void,
  ) {
    this.registerInteractive('stoerung', 'Störung', stoerungPopupHtml,
      (p) => String(p['cause'] || 'Störung'));
    this.registerInteractive('baustelle', 'Baustelle', baustellePopupHtml,
      (p) => String(p['arbeiten'] || 'Baustelle'));
    this.registerInteractive('ruhe', 'Streckenruhe', ruhePopupHtml,
      (p) => String(p['bstLangname'] || 'Streckenruhe'));
  }

  /** Sofort laden, dann 3-min-Poll + SSE-Push (lädt bei Server-Refresh sofort nach). */
  start(): void {
    void this.load();
    this.pollTimer = setInterval(() => void this.load(), REFRESH_MS);
    try {
      this.events = new EventSource(EVENTS_URL);
      this.events.addEventListener('streckeninfo', () => void this.load());
    } catch {
      // EventSource nicht verfügbar -> der Poll genügt als Sicherheitsnetz.
    }
  }

  /** Kategorie ein-/ausblenden (Punkt- und Linien-Layer gemeinsam). */
  setVisible(kat: SiKategorie, on: boolean): void {
    this.visible[kat] = on;
    if (!this.layersReady) return; // Wunschzustand wird beim Anlegen angewandt
    this.controller.setVisible(KAT[kat].line, on);
    this.controller.setVisible(KAT[kat].point, on);
  }

  /** Ruhen-Linien nachziehen, sobald die Strecken-Geometrie (idIndex) geladen ist. */
  rebuildRuhen(): void {
    if (!this.lastData) return;
    const fc = this.lastData.streckenruhen;
    this.controller.onReady(() => {
      this.ensureLayers();
      this.applyRuhen(fc);
    });
  }

  /** Timer/SSE abbauen (React-cleanup); die Karte räumt der Controller ab. */
  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.events?.close();
    this.events = null;
  }

  private async load(): Promise<void> {
    try {
      const data = await getStreckenInfo();
      this.lastData = data;
      this.controller.onReady(() => {
        this.ensureLayers();
        this.controller.addOrSetGeoJson(KAT.stoerung.source, data.stoerungen ?? leer());
        this.controller.addOrSetGeoJson(KAT.baustelle.source, data.baustellen ?? leer());
        this.applyRuhen(data.streckenruhen);
      });
      const counts = {
        stoerungen: data.counts?.stoerungen ?? data.stoerungen?.features?.length ?? 0,
        baustellen: data.counts?.baustellen ?? data.baustellen?.features?.length ?? 0,
        streckenruhen: data.counts?.streckenruhen ?? data.streckenruhen?.features?.length ?? 0,
      };
      this.onDaten({ counts, sammelmeldungen: data.sammelmeldungen ?? [] });
      this.datenGemeldet = true;
      this.onStatus(data.error
        ? `Streckeninfo: ${data.error}`
        : `Streckeninfo: ${counts.stoerungen} Störungen · ${counts.baustellen} Baustellen · `
          + `${counts.streckenruhen} Streckenruhen`);
    } catch (err) {
      // Einträge trotzdem (mit 0) melden, damit die Ebenen-Steuerung umschaltbar bleibt;
      // bereits gemeldete Daten aus einem früheren Load bleiben unangetastet.
      if (!this.datenGemeldet) {
        this.onDaten({ counts: { stoerungen: 0, baustellen: 0, streckenruhen: 0 }, sammelmeldungen: [] });
        this.datenGemeldet = true;
      }
      this.onStatus(`Streckeninfo nicht verfügbar (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /**
   * Streckenruhen als LINIE entlang der ganzen Strecke: die API liefert je Ruhe nur
   * einen Punkt + streckennummer, daher wird die Streckengeometrie aus dem
   * Abschnitts-Index gezogen und gestrichelt nachgezeichnet. Zusätzlich ein
   * Ankerpunkt an der gemeldeten Betriebsstelle (Fallback, falls die Strecke
   * (noch) nicht im Index ist – dann etwas größer).
   */
  private applyRuhen(fc: GeoJSON.FeatureCollection | undefined): void {
    const features: GeoJSON.Feature[] = [];
    for (const f of fc?.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const nr = p['streckennummer'];
      const abschnitte = nr != null ? this.strecken.featuresByNr(String(nr)) : [];
      let gezeichnet = false;
      for (const seg of abschnitte) {
        if (seg.geometry?.type !== 'LineString' && seg.geometry?.type !== 'MultiLineString') continue;
        features.push({ type: 'Feature', geometry: seg.geometry, properties: { ...p } });
        gezeichnet = true;
      }
      if (f.geometry?.type === 'Point') {
        features.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: { ...p, ankerKlein: gezeichnet },
        });
      }
    }
    this.controller.addOrSetGeoJson(KAT.ruhe.source, { type: 'FeatureCollection', features });
  }

  /** Sources + je Kategorie Punkt-/Linien-Layer anlegen (einmalig, nach Style-Load). */
  private ensureLayers(): void {
    if (this.layersReady) return;
    for (const kat of ['stoerung', 'baustelle', 'ruhe'] as const) {
      this.controller.addOrSetGeoJson(KAT[kat].source, leer());
    }
    // SCHWER kräftiger als LEICHT (Linienbreite 6 statt 4, Punktradius 8 statt 6).
    const schwer: ExpressionSpecification =
      ['==', ['coalesce', ['get', 'gleisEinschraenkung'], ''], 'SCHWER'];
    for (const kat of ['stoerung', 'baustelle'] as const) {
      const lineLayer: LayerSpecification = {
        id: KAT[kat].line,
        type: 'line',
        source: KAT[kat].source,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { visibility: this.visible[kat] ? 'visible' : 'none' },
        paint: {
          'line-color': SI_COLOR[kat],
          'line-width': ['case', schwer, 6, 4],
          'line-opacity': 0.9,
        },
      };
      const pointLayer: LayerSpecification = {
        id: KAT[kat].point,
        type: 'circle',
        source: KAT[kat].source,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: this.visible[kat] ? 'visible' : 'none' },
        paint: {
          'circle-radius': ['case', schwer, 8, 6],
          'circle-color': SI_COLOR[kat],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      };
      this.controller.addLayerOnce(lineLayer, TRAINS_LAYER_ID);
      this.controller.addLayerOnce(pointLayer, TRAINS_LAYER_ID);
    }
    // Streckenruhen: gestrichelte Linie entlang der Strecke + Ankerpunkt.
    const ruheLine: LayerSpecification = {
      id: KAT.ruhe.line,
      type: 'line',
      source: KAT.ruhe.source,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: this.visible.ruhe ? 'visible' : 'none' },
      paint: {
        'line-color': SI_COLOR.ruhe,
        'line-width': 4,
        'line-opacity': 0.85,
        'line-dasharray': [1.5, 1.8],
      },
    };
    const ruhePoint: LayerSpecification = {
      id: KAT.ruhe.point,
      type: 'circle',
      source: KAT.ruhe.source,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: this.visible.ruhe ? 'visible' : 'none' },
      paint: {
        // Ankerpunkt etwas kleiner, sobald die Strecke gestrichelt gezeichnet ist.
        'circle-radius': ['case', ['boolean', ['get', 'ankerKlein'], false], 5, 6],
        'circle-color': SI_COLOR.ruhe,
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    };
    this.controller.addLayerOnce(ruheLine, TRAINS_LAYER_ID);
    this.controller.addLayerOnce(ruhePoint, TRAINS_LAYER_ID);
    this.layersReady = true;
  }

  /** Punkt- und Linien-Layer einer Kategorie teilen sich denselben Interaktiv-Spec. */
  private registerInteractive(
    kat: SiKategorie,
    kind: string,
    popup: (p: Record<string, unknown>) => string,
    label: (p: Record<string, unknown>) => string,
  ): void {
    const spec = {
      popupHtml: (f: MapGeoJSONFeature) => popup(f.properties as Record<string, unknown>),
      kindLabel: () => kind,
      nearbyLabel: (f: MapGeoJSONFeature) => label(f.properties as Record<string, unknown>),
      dotColor: () => SI_COLOR[kat],
    };
    this.controller.registerInteractive(KAT[kat].line, spec);
    this.controller.registerInteractive(KAT[kat].point, spec);
  }
}
