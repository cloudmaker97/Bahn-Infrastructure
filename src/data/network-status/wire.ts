// Wire types of the strecken-info.de API (network status: disruptions,
// construction sites, line closures, aggregate notices).
// The PROPERTY NAMES are the external wire format and MUST stay German;
// only the type names and comments are English (internal).

/** Resolves an RL100 to [lon, lat] (or null). Pure/injectable -> testable. */
export type CoordResolver = (ril100: string) => [number, number] | null;

export interface RawPeriod {
  beginn?: string;
  ende?: string;
}

export interface RawEffect {
  wirkung?: string;
  verkehrsarten?: string[];
}

export interface RawValidity {
  vonDatum?: string; // "YYYY-MM-DD"
  bisDatum?: string; // "YYYY-MM-DD"
  wochentage?: string[]; // MONTAG..SONNTAG
  vonUhrzeit?: string; // "HH:MM:SS"
  bisUhrzeit?: string; // "HH:MM:SS"
}

export interface RawPoint {
  x: number;
  y: number;
}

// Location via RL100 (when `koordinaten` are missing): section end or operating point.
export interface RawEndpoint {
  ril100?: string;
  langname?: string;
}

export interface RawSection {
  von?: RawEndpoint;
  bis?: RawEndpoint;
  streckennummer?: number;
}

export interface RawDisruption {
  key?: string;
  cause?: string;
  subcause?: string;
  text?: string;
  wirkungenMitVerkehrsarten?: RawEffect[];
  gleisEinschraenkung?: string;
  zeitraum?: RawPeriod;
  koordinaten?: RawPoint[];
  abschnitte?: RawSection[]; // fallback location (line segments)
  betriebsstellen?: RawEndpoint[]; // fallback location (points)
  sammelmeldung?: boolean;
  geschlossen?: boolean;
  abgelaufen?: boolean;
}

export interface RawConstructionSite {
  baustellenID?: string;
  streckennummern?: number[];
  richtung?: string;
  regionen?: string[];
  wirkung?: string;
  gleisEinschraenkung?: string;
  arbeiten?: string;
  zeitraum?: RawPeriod;
  gueltigkeiten?: RawValidity[];
  langnameVon?: string;
  langnameBis?: string;
  ril100Von?: string;
  ril100Bis?: string;
  koordinaten?: { von?: RawPoint; bis?: RawPoint };
}

export interface RawLineClosure {
  streckenruhenId?: string;
  ril100?: string;
  bstLangname?: string;
  koordinaten?: RawPoint;
  gueltigkeiten?: RawValidity[];
  streckennummer?: number;
  region?: string;
  arbeiten?: string;
  zeitraum?: RawPeriod;
}

/** The four raw arrays exactly as returned by the API endpoints. */
export interface RawNetworkStatus {
  stoerungen: RawDisruption[];
  baustellen: RawConstructionSite[];
  streckenruhen: RawLineClosure[];
  sammelmeldungen: RawDisruption[];
}
