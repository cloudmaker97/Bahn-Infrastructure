// Makes sure the data exists before the server/TUI starts. The data/ directory
// is excluded via .gitignore (see README): on a fresh checkout the data is
// missing and is automatically loaded from the WFS and built into the web
// GeoJSON here.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_RAW, DATA_WEB } from './config.js';
import { scrapeAll } from './scrape.js';
import { buildMapData } from './build-map-data.js';

// Marker files that indicate the presence of the raw and web data.
// line-overview.json also triggers a rebuild on installs that still carry the
// old strecken_uebersicht.json (renamed artifact – self-healing).
const RAW_MARKER = join(DATA_RAW, 'geo_streckenabschnitte.json');
const WEB_MARKER = join(DATA_WEB, 'map_streckenabschnitte.geojson');
const LINE_OVERVIEW = join(DATA_RAW, 'line-overview.json');

/** Loads missing data from the WFS and builds the web GeoJSON when needed. */
export async function ensureData(): Promise<void> {
  const rawMissing = !existsSync(RAW_MARKER);
  if (rawMissing) {
    console.log('Rohdaten fehlen – lade vollstaendig vom DB-WFS (dauert einige Minuten) …');
    await scrapeAll();
  }

  if (rawMissing || !existsSync(WEB_MARKER) || !existsSync(LINE_OVERVIEW)) {
    buildMapData();
  }
}
