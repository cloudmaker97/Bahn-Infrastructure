// Stellt sicher, dass die Daten vorhanden sind, bevor der Server/die TUI startet.
// Das data/-Verzeichnis ist per .gitignore ausgeschlossen (siehe README): bei einem
// frischen Checkout fehlen die Daten und werden hier automatisch vom WFS geladen
// und in die Web-GeoJSON gebaut.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_RAW, DATA_WEB } from './config.js';
import { scrapeAll } from './scrape.js';
import { buildMapData } from './build-map-data.js';

// Marker-Dateien, an denen sich das Vorhandensein der Roh- bzw. Webdaten erkennen laesst.
const RAW_MARKER = join(DATA_RAW, 'geo_streckenabschnitte.json');
const WEB_MARKER = join(DATA_WEB, 'map_streckenabschnitte.geojson');
const UEBERSICHT = join(DATA_RAW, 'strecken_uebersicht.json');

/** Laedt fehlende Daten vom WFS und baut die Web-GeoJSON, falls noetig. */
export async function ensureData(): Promise<void> {
  const rawMissing = !existsSync(RAW_MARKER);
  if (rawMissing) {
    console.log('Rohdaten fehlen – lade vollstaendig vom DB-WFS (dauert einige Minuten) …');
    await scrapeAll();
  }

  if (rawMissing || !existsSync(WEB_MARKER) || !existsSync(UEBERSICHT)) {
    buildMapData();
  }
}
