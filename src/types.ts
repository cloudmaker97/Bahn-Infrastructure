// Gemeinsame Typdefinitionen fuer das ISR-Projekt.

export type Coord = [number, number]; // [lon, lat] (GeoJSON-Konvention)
export type LatLng = [number, number]; // [lat, lon] (Leaflet-Konvention)

export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: {
    type: 'MultiLineString' | 'MultiPoint' | 'LineString' | 'Point';
    coordinates: unknown;
  } | null;
  properties: P;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: GeoFeature<P>[];
  totalFeatures?: number;
}

/** Eigenschaften eines Streckenabschnitts (Auszug, Graph-relevant). */
export interface AbschnittProps {
  ISR_STRE_NR?: number;
  STRECKEN_ABSCHNITT?: string;
  ISR_STRECKE_VON_BIS?: string;
  ISR_STEL_ID_VON?: number;
  ISR_STEL_ID_BIS?: number;
  ISR_KM_VON?: string;
  ISR_KM_BIS?: string;
  ALG_LAENGE_ABSCHNITT?: string;
  BET_GESCHWINDIGKEIT?: string;
  [key: string]: unknown;
}

/** Eine Betriebsstelle (Knoten des Netzes). */
export interface Station {
  stel: number;
  rl100: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
}

/** Eine Graph-Kante zwischen zwei Betriebsstellen. */
export interface Edge {
  to: number;
  timeMin: number;
  distKm: number;
  strecke: number | undefined;
  coords: LatLng[];
}

export type RouteMode = 'fast' | 'short';

export interface RouteWaypoint {
  stel: number;
  rl100: string | null;
  name: string | null;
  lat: number | null;
  lon: number | null;
}

export interface RouteSegment {
  strecke: number | undefined;
  timeMin: number;
  distKm: number;
  coords: LatLng[];
}

export interface RouteResult {
  ok: true;
  mode: RouteMode;
  from: RouteWaypoint;
  to: RouteWaypoint;
  totalTimeMin: number;
  totalDistKm: number;
  nEdges: number;
  nWaypoints: number;
  waypoints: RouteWaypoint[];
  segments: RouteSegment[];
}

export interface RouteError {
  ok: false;
  error: string;
}

/** Ergebnis einer Pfadsuche im Graphen. */
export interface PathResult {
  nodesSeq: number[];
  edges: Edge[];
}

// --- Abstraktionen (DIP/ISP): high-level Module haengen von diesen ab, nicht von Klassen ---

/** Nur die fuer Routing noetige Sicht auf Betriebsstellen. */
export interface StationLookup {
  resolveStel(code: string | undefined): number | null;
  getStation(stel: number): Station | undefined;
}

/** Nur die fuer Routing noetige Sicht auf den Graphen. */
export interface Pathfinder {
  dijkstra(start: number, goal: number, mode: RouteMode): PathResult | null;
}

/** Autocomplete-Vorschlaege. */
export interface StationSuggester {
  suggest(q: string, limit?: number): Station[];
}

/** Volltextsuche ueber alle Entitaeten. Optional auf einen Ergebnistyp eingeschraenkt. */
export interface EntitySearch {
  search(q: string, limit?: number, kind?: SearchEntry['kind'] | null): SearchEntry[];
}

/** Liefert die Abschnitte einer Strecke bzw. die einer Betriebsstelle zugehoerigen Abschnitte. */
export interface AbschnittLookup {
  byStrecke(streckenNr: number): AbschnittProps[];
  /** Alle Abschnitte, an denen die Betriebsstelle (STEL_ID) Anfang oder Ende ist. */
  byStation(stel: number): AbschnittProps[];
}

/** Ein durchsuchbarer Eintrag fuer TUI / Such-API. */
export interface SearchEntry {
  kind: 'Betriebsstelle' | 'Strecke' | 'Tunnel' | 'Brücke' | 'Bahnübergang';
  code: string; // RL100 / Streckennr / Name-Kürzel
  name: string;
  detail: string; // Zusatzinfo fuer die Anzeige
  data: Record<string, unknown>; // vollstaendige Rohdaten
}

// --- Oeffentlicher strecken-info-Datenvertrag (1:1 als JSON ausgeliefert) ---

export interface SammelmeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
}

export interface StoerungMeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];
  gleisEinschraenkung: string;
  verortet: boolean; // hat die Stoerung eine aufloesbare Geometrie?
}

export interface StreckenInfoResult {
  stoerungen: FeatureCollection; // nur verortet UND aktuell aktiv (fuer die Karte)
  baustellen: FeatureCollection;
  streckenruhen: FeatureCollection;
  sammelmeldungen: SammelmeldungDTO[];
  stoerungenListe: StoerungMeldungDTO[]; // ALLE aktiven Stoerungen (auch ohne Ort) fuer Listen/TUI
  generatedAt: string;
  counts: {
    stoerungen: number;
    stoerungenOhneOrt: number;
    baustellen: number;
    streckenruhen: number;
    sammelmeldungen: number;
  };
  error: string | null;
}

/** Nur die fuer die TUI noetige Sicht auf die Betriebslage (DIP/ISP). */
export interface MeldungenProvider {
  getData(opts?: { force?: boolean }): Promise<StreckenInfoResult>;
}
