// Builds web-optimized map_<key>.geojson (data/web) from the geo_<key>.json (data/raw):
//   - coordinates rounded to 5 decimal places (~1 m)
//   - empty/meaningless fields removed
//   - curated field set for line sections (all 171 fields remain in the CSVs)
// Also: line-overview.json for the TUI search.
// Invocation:  npm run build:data
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_RAW, DATA_WEB, LAYERS, NOISE } from './config.js';
import { round5 } from './core/geometry.js';
import type { SectionProps, FeatureCollection, GeoFeature } from './types.js';

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

/** Aggregated line overview (JSON) for the search. */
function buildLineOverview(): void {
  const sections = JSON.parse(readFileSync(join(DATA_RAW, 'streckenabschnitte_meta.json'), 'utf8')) as SectionProps[];
  const map = new Map<number, {
    lineNumber: number; sectionCount: number;
    operators: Set<string>; countries: Set<string>; course: string;
  }>();
  for (const r of sections) {
    const nr = r.ISR_STRE_NR;
    if (nr == null) continue;
    let s = map.get(nr);
    if (!s) { s = { lineNumber: nr, sectionCount: 0, operators: new Set(), countries: new Set(), course: '' }; map.set(nr, s); }
    s.sectionCount++;
    if (typeof r['ALG_INFRA_BETR'] === 'string') s.operators.add(r['ALG_INFRA_BETR']);
    if (typeof r['ALG_STAAT'] === 'string') s.countries.add(r['ALG_STAAT']);
    if (!s.course && typeof r.ISR_STRECKE_VON_BIS === 'string') s.course = r.ISR_STRECKE_VON_BIS;
  }
  const rows = [...map.values()].sort((a, b) => a.lineNumber - b.lineNumber).map((s) => ({
    lineNumber: s.lineNumber, sectionCount: s.sectionCount,
    operators: [...s.operators].join(' | '), countries: [...s.countries].join(' | '), course: s.course,
  }));
  writeFileSync(join(DATA_RAW, 'line-overview.json'), JSON.stringify(rows));
  console.log(`  line-overview.json: ${rows.length} Strecken`);
}

/** Builds the web-optimized data/web/map_*.geojson + overview from data/raw/geo_*.json. */
export function buildMapData(): void {
  mkdirSync(DATA_WEB, { recursive: true });
  console.log('Baue Web-GeoJSON ...');
  for (const l of LAYERS) buildLayer(l.key, l.whitelist);
  buildLineOverview();
  console.log('FERTIG');
}

// Direct invocation via `npm run build:data`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildMapData();
}
