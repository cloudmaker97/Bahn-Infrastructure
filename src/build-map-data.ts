// Erzeugt aus den geo_<key>.json (data/raw) web-optimierte map_<key>.geojson (data/web):
//   - Koordinaten auf 5 Nachkommastellen (~1 m)
//   - leere/nichtssagende Felder entfernt
//   - fuer Streckenabschnitte kuratiertes Feldset (volle 171 Felder bleiben in den CSVs)
// Ausserdem: strecken_uebersicht.json fuer die TUI-Recherche.
// Aufruf:  npm run build:data
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_RAW, DATA_WEB, LAYERS, NOISE } from './config.js';
import { round5 } from './core/geometry.js';
import type { AbschnittProps, FeatureCollection, GeoFeature } from './types.js';

const isNoise = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && NOISE.has(v.trim())) || NOISE.has(v as string);

function cleanProps(p: Record<string, unknown>, whitelist?: string[]): Record<string, unknown> {
  const keys = whitelist ?? Object.keys(p);
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in p && !isNoise(p[k])) out[k] = p[k];
  return out;
}

function roundGeom(g: GeoFeature['geometry']): GeoFeature['geometry'] {
  if (!g) return g;
  if (g.type === 'MultiLineString') {
    g.coordinates = (g.coordinates as number[][][]).map(
      (line) => line.map(([x, y]) => [round5(x!), round5(y!)]));
  } else if (g.type === 'MultiPoint') {
    g.coordinates = (g.coordinates as number[][]).map((pt) => pt.map(round5));
  }
  return g;
}

function buildLayer(key: string, whitelist?: string[]): void {
  const src = join(DATA_RAW, `geo_${key}.json`);
  if (!existsSync(src)) { console.warn(`  ! geo_${key}.json fehlt – uebersprungen`); return; }
  const gj = JSON.parse(readFileSync(src, 'utf8')) as FeatureCollection;
  const out: FeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const f of gj.features) {
    if (!f.geometry) continue;
    out.features.push({
      type: 'Feature',
      geometry: roundGeom(f.geometry),
      properties: cleanProps(f.properties, whitelist),
    });
  }
  writeFileSync(join(DATA_WEB, `map_${key}.geojson`), JSON.stringify(out));
  console.log(`  map_${key}.geojson: ${out.features.length} Features`);
}

/** Aggregierte Strecken-Uebersicht (JSON) fuer die Recherche. */
function buildStreckenUebersicht(): void {
  const ab = JSON.parse(readFileSync(join(DATA_RAW, 'streckenabschnitte_meta.json'), 'utf8')) as AbschnittProps[];
  const map = new Map<number, {
    ISR_STRE_NR: number; anz_abschnitte: number;
    betreiber: Set<string>; staat: Set<string>; verlauf: string;
  }>();
  for (const r of ab) {
    const nr = r.ISR_STRE_NR;
    if (nr == null) continue;
    let s = map.get(nr);
    if (!s) { s = { ISR_STRE_NR: nr, anz_abschnitte: 0, betreiber: new Set(), staat: new Set(), verlauf: '' }; map.set(nr, s); }
    s.anz_abschnitte++;
    if (typeof r['ALG_INFRA_BETR'] === 'string') s.betreiber.add(r['ALG_INFRA_BETR']);
    if (typeof r['ALG_STAAT'] === 'string') s.staat.add(r['ALG_STAAT']);
    if (!s.verlauf && typeof r.ISR_STRECKE_VON_BIS === 'string') s.verlauf = r.ISR_STRECKE_VON_BIS;
  }
  const rows = [...map.values()].sort((a, b) => a.ISR_STRE_NR - b.ISR_STRE_NR).map((s) => ({
    ISR_STRE_NR: s.ISR_STRE_NR, anz_abschnitte: s.anz_abschnitte,
    betreiber: [...s.betreiber].join(' | '), staat: [...s.staat].join(' | '), verlauf: s.verlauf,
  }));
  writeFileSync(join(DATA_RAW, 'strecken_uebersicht.json'), JSON.stringify(rows));
  console.log(`  strecken_uebersicht.json: ${rows.length} Strecken`);
}

/** Baut aus data/raw/geo_*.json die web-optimierten data/web/map_*.geojson + Uebersicht. */
export function buildMapData(): void {
  mkdirSync(DATA_WEB, { recursive: true });
  console.log('Baue Web-GeoJSON ...');
  for (const l of LAYERS) buildLayer(l.key, l.whitelist);
  buildStreckenUebersicht();
  console.log('FERTIG');
}

// Direktaufruf per `npm run build:data`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildMapData();
}
