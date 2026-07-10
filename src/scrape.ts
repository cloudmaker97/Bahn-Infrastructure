// WFS scraper: downloads all ISR layers defined in config.LAYERS from the DB GeoServer.
// Writes per layer:  geo_<key>.json (geometry WGS84) + <key>_meta.json (properties) + <key>.csv
// Invocation:  npm run scrape           (all layers)
//              npm run scrape -- tunnel (a single layer)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_RAW, WFS_BASE, LAYERS } from './config.js';
import type { FeatureCollection } from './types.js';

async function wfs(params: Record<string, string>): Promise<Response> {
  const q = new URLSearchParams({ service: 'WFS', version: '1.1.0', ...params });
  const res = await fetch(`${WFS_BASE}?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fuer ${params['typeName']}`);
  return res;
}

async function describeAttrs(typeName: string): Promise<string[]> {
  const xml = await (await wfs({ request: 'DescribeFeatureType', typeName })).text();
  const names = [...xml.matchAll(/<xsd:element[^>]*name="([^"]+)"/g)].map((m) => m[1]!);
  return names.filter((n) => !n.startsWith('ISR_V_') &&
    !['GEOMETRIE', 'GEOMETRIE_PUNKT'].includes(n.toUpperCase()));
}

function toCsv(props: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [props.join(',')];
  for (const r of rows) lines.push(props.map((k) => esc(r[k])).join(','));
  return '﻿' + lines.join('\r\n'); // BOM for Excel
}

async function scrapeLayer(key: string, typeName: string): Promise<void> {
  console.log(`[${key}] Attribute holen ...`);
  const props = await describeAttrs(typeName);
  console.log(`[${key}] ${props.length} Attribute – lade Geometrie (WGS84) ...`);
  const geoTxt = await (await wfs({
    request: 'GetFeature', typeName, outputFormat: 'json',
    viewParams: 'LANG:DE', srsName: 'EPSG:4326',
  })).text();
  writeFileSync(join(DATA_RAW, `geo_${key}.json`), geoTxt);
  const gj = JSON.parse(geoTxt) as FeatureCollection;
  const rows = gj.features.map((f) => f.properties);
  console.log(`[${key}] ${gj.features.length} von ${gj.totalFeatures} Features`);
  writeFileSync(join(DATA_RAW, `${key}_meta.json`), JSON.stringify(rows));
  writeFileSync(join(DATA_RAW, `${key}.csv`), toCsv(props, rows));
  console.log(`[${key}] fertig.`);
}

/** Scrapes all layers (or only `only`, when given) from the WFS into data/raw. */
export async function scrapeAll(only?: string): Promise<void> {
  mkdirSync(DATA_RAW, { recursive: true });
  for (const l of LAYERS) {
    if (only && l.key !== only) continue;
    await scrapeLayer(l.key, l.typeName);
  }
  console.log('FERTIG');
}

// Direct invocation via `npm run scrape [-- <layer>]`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  scrapeAll(process.argv[2]).catch((e) => { console.error('Fehler:', e); process.exit(1); });
}
