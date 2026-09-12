// Basemap styles served by the self-hosted TileServer GL
// (https://tiles.map.apps.dennis-heinri.ch/). Dark Matter and Basic preview
// are vector GL styles; switching them is a MapLibre setStyle, so overlays
// re-attach on style.load (see MapController.onStyleLoad).

export type BasemapId = 'dark' | 'basic';

const TILE_ORIGIN = 'https://tiles.map.apps.dennis-heinri.ch';

/** GL style URLs keyed by the UI ids (dark / basic). */
const STYLE_URL: Record<BasemapId, string> = {
  dark: `${TILE_ORIGIN}/styles/dark-matter/style.json`,
  basic: `${TILE_ORIGIN}/styles/basic-preview/style.json`,
};

export const BASEMAP_OPTIONS: ReadonlyArray<{ id: BasemapId; label: string }> = [
  { id: 'dark', label: 'Dark' },
  { id: 'basic', label: 'Basic' },
];

export const DEFAULT_BASEMAP: BasemapId = 'dark';

const STORAGE_KEY = 'isr.basemap';

/** Resolves a stored/unknown value to a known basemap id. */
export function parseBasemapId(value: string | null | undefined): BasemapId {
  return value === 'basic' ? 'basic' : DEFAULT_BASEMAP;
}

export function styleUrl(id: BasemapId): string {
  return STYLE_URL[id];
}

export function readStoredBasemap(): BasemapId {
  try {
    return parseBasemapId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function persistBasemap(id: BasemapId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode / blocked storage – the in-memory choice still applies */
  }
}

/** Extra attribution appended to the OSM/OpenMapTiles credit from the tiles. */
export const DATA_ATTRIBUTION =
  'Daten: <a href="https://geoviewer.deutschebahn.com/maps/#/context/ISR/275618" target="_blank" rel="noopener">DB InfraGO</a>'
  + ' · Live-Züge: <a href="https://transitous.org/sources" target="_blank" rel="noopener">Transitous</a>';
