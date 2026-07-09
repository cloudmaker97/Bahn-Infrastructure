// Holt die aktuelle Betriebslage (Stoerungen, Baustellen, Streckenruhen,
// Sammelmeldungen) von strecken-info.de und liefert sie als GeoJSON.
// Verantwortung: strecken-info-Aufbereitung (SRP). Reine Funktionen
// (Koordinaten-Umrechnung, Aktiv-Filter, GeoJSON-Bau) sind vom Netz/Cache
// getrennt, damit sie ohne Netz testbar sind.
import type {
  FeatureCollection,
  GeoFeature,
  StationLookup,
  StreckenInfoResult,
  SammelmeldungDTO,
  StoerungMeldungDTO,
  VerlaufLookup,
} from '../types.js';

export type { StreckenInfoResult, SammelmeldungDTO, StoerungMeldungDTO } from '../types.js';

/** Loest einen RL100 zu [lon, lat] auf (oder null). Rein/injizierbar -> testbar. */
export type CoordResolver = (ril100: string) => [number, number] | null;

// --- Schmale Sichten auf die Roh-API-Objekte (nur benutzte Felder) ---

interface RawZeitraum {
  beginn?: string;
  ende?: string;
}

interface RawWirkung {
  wirkung?: string;
  verkehrsarten?: string[];
}

interface RawGueltigkeit {
  vonDatum?: string; // "YYYY-MM-DD"
  bisDatum?: string; // "YYYY-MM-DD"
  wochentage?: string[]; // MONTAG..SONNTAG
  vonUhrzeit?: string; // "HH:MM:SS"
  bisUhrzeit?: string; // "HH:MM:SS"
}

interface RawPunkt {
  x: number;
  y: number;
}

// Verortung ueber RL100 (wenn koordinaten fehlen): Abschnitts-Ende bzw. Betriebsstelle.
interface RawOrtsende {
  ril100?: string;
  langname?: string;
}

interface RawAbschnitt {
  von?: RawOrtsende;
  bis?: RawOrtsende;
  streckennummer?: number;
}

interface RawStoerung {
  key?: string;
  cause?: string;
  subcause?: string;
  text?: string;
  wirkungenMitVerkehrsarten?: RawWirkung[];
  gleisEinschraenkung?: string;
  zeitraum?: RawZeitraum;
  koordinaten?: RawPunkt[];
  abschnitte?: RawAbschnitt[]; // Fallback-Verortung (Liniensegmente)
  betriebsstellen?: RawOrtsende[]; // Fallback-Verortung (Punkte)
  sammelmeldung?: boolean;
  geschlossen?: boolean;
  abgelaufen?: boolean;
}

interface RawBaustelle {
  baustellenID?: string;
  streckennummern?: number[];
  richtung?: string;
  regionen?: string[];
  wirkung?: string;
  gleisEinschraenkung?: string;
  arbeiten?: string;
  zeitraum?: RawZeitraum;
  gueltigkeiten?: RawGueltigkeit[];
  langnameVon?: string;
  langnameBis?: string;
  ril100Von?: string;
  ril100Bis?: string;
  koordinaten?: { von?: RawPunkt; bis?: RawPunkt };
}

interface RawStreckenruhe {
  streckenruhenId?: string;
  ril100?: string;
  bstLangname?: string;
  koordinaten?: RawPunkt;
  gueltigkeiten?: RawGueltigkeit[];
  streckennummer?: number;
  region?: string;
  arbeiten?: string;
  zeitraum?: RawZeitraum;
}

/** Die vier Roh-Arrays, wie sie von den API-Endpunkten kommen. */
export interface StreckenInfoRohdaten {
  stoerungen: RawStoerung[];
  baustellen: RawBaustelle[];
  streckenruhen: RawStreckenruhe[];
  sammelmeldungen: RawStoerung[];
}

// --- Reine Geo-Funktion: EPSG:3857 (Web-Mercator) -> WGS84 ---

/** Rechnet einen Web-Mercator-Punkt in WGS84 um. Gibt [lon, lat] (GeoJSON-Reihenfolge). */
export function mercatorToWgs84(x: number, y: number): [number, number] {
  const R = 6378137;
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

// --- Reine Zeit-Helfer (alle API-Zeiten sind naive Ortszeit Europe/Berlin) ---

// getDay() 0=Sonntag..6=Samstag -> deutscher Wochentagsname.
const WOCHENTAGE = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG'] as const;

/** Lokales Datum als "YYYY-MM-DD" (lexikografisch vergleichbar). */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lokale Uhrzeit als "HH:MM:SS" (lexikografisch vergleichbar). */
function localTimeStr(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}`;
}

/** Parst eine naive ISO-Ortszeit ("YYYY-MM-DDTHH:MM:SS") als lokales Date oder null. */
function parseNaiveLocal(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prueft, ob ein einzelnes Gueltigkeitsfenster den Zeitpunkt `now` abdeckt. */
function gueltigkeitDecktAb(g: RawGueltigkeit, now: Date): boolean {
  // 1. Datum in [vonDatum, bisDatum] (inklusive, lexikografisch bei YYYY-MM-DD).
  const heute = localDateStr(now);
  if (g.vonDatum && heute < g.vonDatum) return false;
  if (g.bisDatum && heute > g.bisDatum) return false;

  // 2. Wochentag muss enthalten sein.
  const tag = WOCHENTAGE[now.getDay()]!;
  if (g.wochentage && g.wochentage.length > 0 && !g.wochentage.includes(tag)) return false;

  // 3. Uhrzeit im Fenster [vonUhrzeit, bisUhrzeit].
  const von = g.vonUhrzeit;
  const bis = g.bisUhrzeit;
  if (von && bis) {
    const jetzt = localTimeStr(now);
    if (von <= bis) {
      // Normales Fenster innerhalb eines Tages.
      if (jetzt < von || jetzt > bis) return false;
    } else {
      // Fenster ueber Mitternacht (z. B. 20:00-04:00): aktiv wenn >= von ODER <= bis.
      if (jetzt < von && jetzt > bis) return false;
    }
  }
  return true;
}

/**
 * Rein: ist ein Element JETZT aktiv?
 * - Mit `gueltigkeiten` (Baustellen, Streckenruhen): aktiv, wenn IRGENDEIN Fenster `now` abdeckt.
 * - Ohne `gueltigkeiten` (Stoerungen): aktiv, wenn `now` in [zeitraum.beginn, zeitraum.ende]
 *   UND weder `abgelaufen` noch `geschlossen` gesetzt sind.
 */
export function istAktuellAktiv(item: unknown, now: Date): boolean {
  const it = item as {
    gueltigkeiten?: RawGueltigkeit[];
    zeitraum?: RawZeitraum;
    abgelaufen?: boolean;
    geschlossen?: boolean;
  };

  if (Array.isArray(it.gueltigkeiten) && it.gueltigkeiten.length > 0) {
    return it.gueltigkeiten.some((g) => gueltigkeitDecktAb(g, now));
  }

  // Stoerungen: Zeitraum + Status-Flags.
  if (it.abgelaufen === true || it.geschlossen === true) return false;
  const beginn = parseNaiveLocal(it.zeitraum?.beginn);
  const ende = parseNaiveLocal(it.zeitraum?.ende);
  if (beginn && now < beginn) return false;
  if (ende && now > ende) return false;
  return true;
}

// --- Reine GeoJSON-Bau-Helfer ---

/** Baut eine FeatureCollection aus fertigen Features. */
function featureCollection(features: GeoFeature[]): FeatureCollection {
  return { type: 'FeatureCollection', features, totalFeatures: features.length };
}

/** Waehlt Point (1 Koordinate) oder LineString (>=2); null bei leerer Liste. */
function linieOderPunkt(coords: [number, number][]): GeoFeature['geometry'] {
  if (coords.length === 0) return null;
  if (coords.length === 1) return { type: 'Point', coordinates: coords[0]! };
  return { type: 'LineString', coordinates: coords };
}

/** Fuehrt die Verkehrsarten aller Wirkungen flach zusammen (dedupliziert). */
function verkehrsartenFlach(wirkungen: RawWirkung[] | undefined): string[] {
  const set = new Set<string>();
  for (const w of wirkungen ?? []) {
    for (const v of w.verkehrsarten ?? []) set.add(v);
  }
  return [...set];
}

/**
 * Verortet die `abschnitte` einer Stoerung ueber RL100 zu Segmenten
 * (MultiLineString/LineString) entlang des realen Streckenverlaufs (resolveVerlauf,
 * sonst Luftlinie). Richtungs-Duplikate (A->B + B->A) werden nur einmal gezeichnet,
 * Abschnitte mit nur einem aufloesbaren Ende gehen als Punkt ein.
 * Gibt zusaetzlich `geroutet` zurueck: true, sobald mindestens ein Abschnitt eine
 * gleisgenaue Kette (statt Luftlinie) geliefert hat – das entscheidet, ob dieser
 * Verlauf eine direkte 2-Punkt-Luftlinie aus `koordinaten` schlagen darf.
 * Null, wenn kein Abschnitt verortbar war.
 */
function abschnitteGeometry(
  abschnitte: RawAbschnitt[],
  resolveCoord: CoordResolver,
  resolveVerlauf?: VerlaufLookup,
): { geometry: GeoFeature['geometry']; geroutet: boolean } | null {
  const segmente: [number, number][][] = [];
  const punkte: [number, number][] = [];
  const gesehen = new Set<string>();
  let geroutet = false;
  for (const a of abschnitte) {
    const vonRil = a.von?.ril100;
    const bisRil = a.bis?.ril100;
    const von = vonRil ? resolveCoord(vonRil) : null;
    const bis = bisRil ? resolveCoord(bisRil) : null;
    if (vonRil && bisRil) {
      const key = [vonRil.trim(), bisRil.trim()].sort().join('>') + `@${a.streckennummer ?? ''}`;
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      // Verlauf haengt nur an den RIL-Codes (der Resolver kennt den
      // Bft-Fallback), NICHT an resolveCoord – sonst degradieren Abschnitte
      // mit Bahnhofsteil-Enden zum Punkt, obwohl sie routbar waeren.
      const verlauf = resolveVerlauf
        ? resolveVerlauf(vonRil, bisRil, a.streckennummer != null ? [a.streckennummer] : undefined)
        : null;
      if (verlauf) { segmente.push(verlauf); geroutet = true; continue; }
    }
    if (von && bis) segmente.push([von, bis]);
    else if (von) punkte.push(von);
    else if (bis) punkte.push(bis);
  }
  if (segmente.length > 0) {
    // Die Geometrie-Union kennt keinen gemischten Typ; einzelne Punkte werden
    // daher als degenerierte Segmente [p,p] mit in den MultiLineString gefuehrt.
    for (const p of punkte) segmente.push([p, p]);
    const geometry: GeoFeature['geometry'] = segmente.length === 1
      ? { type: 'LineString', coordinates: segmente[0]! }
      : { type: 'MultiLineString', coordinates: segmente };
    return { geometry, geroutet };
  }
  if (punkte.length === 1) return { geometry: { type: 'Point', coordinates: punkte[0]! }, geroutet: false };
  if (punkte.length > 1) return { geometry: { type: 'MultiPoint', coordinates: punkte }, geroutet: false };
  return null;
}

/**
 * Ermittelt die Geometrie einer Stoerung mit Fallback-Kaskade:
 *  a) `koordinaten` (Mercator) -> LineString/Point. Eine 2-Punkt-`koordinaten`-Linie
 *     ist aber selbst eine Luftlinie: liefern die `abschnitte` einen gleisgenauen
 *     Verlauf, hat dieser Vorrang (strecken-info liefert oft nur die zwei Endpunkte);
 *  b) sonst `abschnitte` ueber RL100 -> Streckenverlauf (s. abschnitteGeometry);
 *  c) sonst `betriebsstellen` ueber RL100 -> MultiPoint/Point;
 *  d) sonst null (nicht verortbar).
 */
function stoerungGeometry(
  s: RawStoerung,
  resolveCoord: CoordResolver,
  resolveVerlauf?: VerlaufLookup,
): GeoFeature['geometry'] {
  const abschnitte = s.abschnitte ?? [];

  // a) Direkte Mercator-Koordinaten.
  const koord = (s.koordinaten ?? []).map((p) => mercatorToWgs84(p.x, p.y));
  if (koord.length > 0) {
    // Genau zwei Punkte = gerade Luftlinie. Routen die abschnitte gleisgenau,
    // gewinnt der reale Verlauf; sonst bleibt es bei den koordinaten (kein Regress).
    if (koord.length === 2 && abschnitte.length > 0) {
      const ausAbschnitten = abschnitteGeometry(abschnitte, resolveCoord, resolveVerlauf);
      if (ausAbschnitten?.geroutet) return ausAbschnitten.geometry;
    }
    return linieOderPunkt(koord);
  }

  // b) Abschnitte ueber RL100 (wie bisher: vorhandene abschnitte "gewinnen" –
  //    sind sie nicht verortbar, bleibt es bei null statt Fall-through zu c).
  if (abschnitte.length > 0) {
    return abschnitteGeometry(abschnitte, resolveCoord, resolveVerlauf)?.geometry ?? null;
  }

  // c) Betriebsstellen ueber RL100.
  const bst = s.betriebsstellen ?? [];
  if (bst.length > 0) {
    const punkte: [number, number][] = [];
    for (const b of bst) {
      const c = b.ril100 ? resolveCoord(b.ril100) : null;
      if (c) punkte.push(c);
    }
    if (punkte.length === 1) return { type: 'Point', coordinates: punkte[0]! };
    if (punkte.length > 1) return { type: 'MultiPoint', coordinates: punkte };
  }

  // d) Nicht verortbar.
  return null;
}

/** Rein: eine Stoerung -> GeoFeature (Geometrie via Fallback-Kaskade, ggf. geometry null). */
export function toStoerungFeature(
  s: RawStoerung,
  resolveCoord: CoordResolver,
  resolveVerlauf?: VerlaufLookup,
): GeoFeature {
  return {
    type: 'Feature',
    geometry: stoerungGeometry(s, resolveCoord, resolveVerlauf),
    properties: {
      kategorie: 'stoerung',
      key: s.key ?? '',
      cause: s.cause ?? '',
      subcause: s.subcause ?? '',
      text: s.text ?? '',
      gleisEinschraenkung: s.gleisEinschraenkung ?? '',
      beginn: s.zeitraum?.beginn ?? '',
      ende: s.zeitraum?.ende ?? '',
      wirkungen: (s.wirkungenMitVerkehrsarten ?? []).map((w) => ({
        wirkung: w.wirkung ?? '',
        verkehrsarten: w.verkehrsarten ?? [],
      })),
    },
  };
}

/**
 * Rein: eine Baustelle -> GeoFeature (Point bei von==bis; sonst realer
 * Streckenverlauf via resolveVerlauf, Fallback Luftlinie [von,bis]).
 */
export function toBaustelleFeature(b: RawBaustelle, resolveVerlauf?: VerlaufLookup): GeoFeature {
  const von = b.koordinaten?.von;
  const bis = b.koordinaten?.bis;
  const coords: [number, number][] = [];
  if (von) coords.push(mercatorToWgs84(von.x, von.y));
  if (bis && !(von && von.x === bis.x && von.y === bis.y)) coords.push(mercatorToWgs84(bis.x, bis.y));
  let geometry = linieOderPunkt(coords);
  if (coords.length === 2 && resolveVerlauf && b.ril100Von && b.ril100Bis) {
    const verlauf = resolveVerlauf(b.ril100Von, b.ril100Bis, b.streckennummern);
    if (verlauf) geometry = { type: 'LineString', coordinates: verlauf };
  }
  return {
    type: 'Feature',
    geometry,
    properties: {
      kategorie: 'baustelle',
      id: b.baustellenID ?? '',
      arbeiten: b.arbeiten ?? '',
      wirkung: b.wirkung ?? '',
      gleisEinschraenkung: b.gleisEinschraenkung ?? '',
      streckennummern: b.streckennummern ?? [],
      richtung: b.richtung ?? '',
      langnameVon: b.langnameVon ?? '',
      langnameBis: b.langnameBis ?? '',
      ril100Von: b.ril100Von ?? '',
      ril100Bis: b.ril100Bis ?? '',
      beginn: b.zeitraum?.beginn ?? '',
      ende: b.zeitraum?.ende ?? '',
      gueltigkeiten: b.gueltigkeiten ?? [],
    },
  };
}

/** Rein: eine Streckenruhe -> GeoFeature (Point). */
export function toStreckenruheFeature(r: RawStreckenruhe): GeoFeature {
  const k = r.koordinaten;
  const coords: [number, number][] = k ? [mercatorToWgs84(k.x, k.y)] : [];
  return {
    type: 'Feature',
    geometry: linieOderPunkt(coords),
    properties: {
      kategorie: 'streckenruhe',
      id: r.streckenruhenId ?? '',
      bstLangname: r.bstLangname ?? '',
      ril100: r.ril100 ?? '',
      streckennummer: r.streckennummer ?? null,
      region: r.region ?? '',
      arbeiten: r.arbeiten ?? '',
      beginn: r.zeitraum?.beginn ?? '',
      ende: r.zeitraum?.ende ?? '',
      gueltigkeiten: r.gueltigkeiten ?? [],
    },
  };
}

/** Rein: eine Stoerung -> Text-DTO fuer Listen/TUI (Geo-unabhaengig). */
export function toStoerungMeldungDTO(s: RawStoerung, verortet: boolean): StoerungMeldungDTO {
  return {
    key: s.key ?? '',
    cause: s.cause ?? '',
    subcause: s.subcause ?? '',
    text: s.text ?? '',
    beginn: s.zeitraum?.beginn ?? '',
    ende: s.zeitraum?.ende ?? '',
    verkehrsarten: verkehrsartenFlach(s.wirkungenMitVerkehrsarten),
    gleisEinschraenkung: s.gleisEinschraenkung ?? '',
    verortet,
  };
}

/** Rein: eine Sammelmeldung -> DTO fuer die Panel-Liste. */
export function toSammelmeldungDTO(s: RawStoerung): SammelmeldungDTO {
  return {
    key: s.key ?? '',
    cause: s.cause ?? '',
    subcause: s.subcause ?? '',
    text: s.text ?? '',
    beginn: s.zeitraum?.beginn ?? '',
    ende: s.zeitraum?.ende ?? '',
    verkehrsarten: verkehrsartenFlach(s.wirkungenMitVerkehrsarten),
  };
}

/**
 * Zentrale, rein testbare Funktion: baut aus den vier Roh-Arrays das
 * StreckenInfoResult (ohne generatedAt/error). Filtert auf "aktuell aktiv"
 * und (bei Stoerungen) auf verortete Nicht-Sammelmeldungen.
 */
export function baueGeoJson(
  rohdaten: StreckenInfoRohdaten,
  now: Date,
  resolveCoord: CoordResolver,
  resolveVerlauf?: VerlaufLookup,
): Omit<StreckenInfoResult, 'generatedAt' | 'error'> {
  const rohStoerungen = Array.isArray(rohdaten.stoerungen) ? rohdaten.stoerungen : [];
  const rohBaustellen = Array.isArray(rohdaten.baustellen) ? rohdaten.baustellen : [];
  const rohStreckenruhen = Array.isArray(rohdaten.streckenruhen) ? rohdaten.streckenruhen : [];
  const rohSammel = Array.isArray(rohdaten.sammelmeldungen) ? rohdaten.sammelmeldungen : [];

  // Stoerungen: Nicht-Sammelmeldungen, aktuell aktiv; Geometrie via Fallback-Kaskade.
  const stoerungenAktiv = rohStoerungen.filter(
    (s) => s.sammelmeldung !== true && istAktuellAktiv(s, now),
  );
  const stoerungenAlle = stoerungenAktiv.map((s) => toStoerungFeature(s, resolveCoord, resolveVerlauf));
  // Nur verortete Features in die Karte; Null-Geometrien separat zaehlen.
  const stoerungenFeat = stoerungenAlle.filter((f) => f.geometry !== null);
  const stoerungenOhneOrt = stoerungenAlle.length - stoerungenFeat.length;
  // Text-Liste ALLER aktiven Stoerungen (verortet-Flag aus der gebauten Geometrie).
  const stoerungenListe = stoerungenAktiv.map((s, i) =>
    toStoerungMeldungDTO(s, stoerungenAlle[i]!.geometry !== null),
  );

  const baustellenFeat = rohBaustellen
    .filter((b) => istAktuellAktiv(b, now))
    .map((b) => toBaustelleFeature(b, resolveVerlauf));

  const streckenruhenFeat = rohStreckenruhen
    .filter((r) => istAktuellAktiv(r, now))
    .map(toStreckenruheFeature);

  const sammelmeldungen = rohSammel.map(toSammelmeldungDTO);

  return {
    stoerungen: featureCollection(stoerungenFeat),
    baustellen: featureCollection(baustellenFeat),
    streckenruhen: featureCollection(streckenruhenFeat),
    sammelmeldungen,
    stoerungenListe,
    counts: {
      stoerungen: stoerungenFeat.length,
      stoerungenOhneOrt,
      baustellen: baustellenFeat.length,
      streckenruhen: streckenruhenFeat.length,
      sammelmeldungen: sammelmeldungen.length,
    },
  };
}

// --- Netz-Konstanten ---

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'JavaScript',
  Origin: 'https://strecken-info.de',
  Referer: 'https://strecken-info.de/',
  'User-Agent': 'Mozilla/5.0',
};

// Pflicht-Filter: leeres regionalbereiche-Array liefert fast nichts!
const FILTER = {
  baustellenAktiv: true,
  baustellenNurTotalsperrung: false,
  streckenruhenAktiv: true,
  stoerungenAktiv: true,
  wirkungsdauer: 0,
  zeitraum: { type: 'ROLLIEREND', stunden: 0 },
  regionalbereiche: ['NORD', 'OST', 'SUED', 'SUEDOST', 'SUEDWEST', 'WEST', 'MITTE'],
  streckennummern: [] as number[],
  betriebsstellen: [] as string[],
} as const;

const WS_TIMEOUT_MS = 12_000;

// --- Service (Netz + Cache) ---

export class StreckenInfoService {
  private readonly apiBase: string;
  private readonly wsUrl: string;
  private readonly ttlMs: number;
  private readonly onRefresh: (() => void) | null;
  private readonly verlauf: VerlaufLookup | undefined;
  private cache: { data: StreckenInfoResult; ts: number } | null = null;

  constructor(
    private stations: StationLookup,
    opts?: {
      apiBase?: string; wsUrl?: string; ttlMs?: number; onRefresh?: () => void;
      /** Realer Streckenverlauf fuer Meldungen (statt Luftlinie); optional. */
      verlauf?: VerlaufLookup;
    },
  ) {
    this.apiBase = opts?.apiBase ?? 'https://strecken-info.de/api';
    this.wsUrl = opts?.wsUrl ?? 'wss://strecken-info.de/api/websocket';
    this.ttlMs = opts?.ttlMs ?? 180_000;
    this.onRefresh = opts?.onRefresh ?? null;
    this.verlauf = opts?.verlauf;
  }

  /**
   * Ergebnis-Cache verwerfen (z. B. nach einem Daten-Reload: das gecachte
   * GeoJSON wurde mit den alten Graph-Geometrien gebaut). Der naechste
   * getData()-Aufruf scrapt und baut dann frisch.
   */
  invalidate(): void {
    this.cache = null;
  }

  /** Loest einen RL100 ueber die ISR-Betriebsstellen zu [lon, lat] auf. */
  private resolveCoord: CoordResolver = (ril100) => {
    const stel = this.stations.resolveStel(ril100.trim());
    if (stel == null) return null;
    const s = this.stations.getStation(stel);
    if (!s || s.lat == null || s.lon == null) return null;
    return [s.lon, s.lat];
  };

  /** Leeres Ergebnis mit optionaler Fehlermeldung. */
  private static empty(error: string | null, generatedAt: string): StreckenInfoResult {
    return {
      stoerungen: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      baustellen: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      streckenruhen: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      sammelmeldungen: [],
      stoerungenListe: [],
      generatedAt,
      counts: { stoerungen: 0, stoerungenOhneOrt: 0, baustellen: 0, streckenruhen: 0, sammelmeldungen: 0 },
      error,
    };
  }

  /** Oeffnet den WS einmal und liest die Revision aus der ersten Handshake-Nachricht. */
  private holeRevisionEinmal(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const fertig = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        fn();
      };
      const timer = setTimeout(() => {
        fertig(() => reject(new Error('WebSocket-Timeout beim Revision-Handshake')));
      }, WS_TIMEOUT_MS);

      ws.onmessage = (ev: MessageEvent) => {
        if (settled) return;
        try {
          const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
          const msg = JSON.parse(text) as { revision?: { nummer?: number } };
          const nummer = msg.revision?.nummer;
          if (typeof nummer === 'number') fertig(() => resolve(nummer));
          // Nachricht ohne Revision: weiter warten (bis Timeout).
        } catch {
          fertig(() => reject(new Error('WebSocket-Nachricht nicht parsebar')));
        }
      };
      ws.onerror = () => fertig(() => reject(new Error('WebSocket-Fehler')));
      ws.onclose = () => fertig(() => reject(new Error('WebSocket geschlossen ohne Revision')));
    });
  }

  /** Holt die Revision mit einem Retry. */
  private async holeRevision(): Promise<number> {
    try {
      return await this.holeRevisionEinmal();
    } catch {
      return await this.holeRevisionEinmal();
    }
  }

  /** POST auf einen Datenendpunkt mit {revision, filter}. */
  private async post<T>(pfad: string, revision: number): Promise<T> {
    const res = await fetch(`${this.apiBase}/${pfad}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ revision, filter: FILTER }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${pfad}`);
    return (await res.json()) as T;
  }

  /**
   * Gecacht (TTL). Wirft NIE: bei Fehler wird das (auch veraltete) Cache-Ergebnis
   * mit gesetztem `error` geliefert, sonst ein leeres Result mit `error`.
   */
  async getData(opts?: { force?: boolean }): Promise<StreckenInfoResult> {
    const nowMs = Date.now();
    if (!opts?.force && this.cache && nowMs - this.cache.ts < this.ttlMs) {
      return this.cache.data;
    }

    try {
      const revision = await this.holeRevision();
      const [stoerungen, baustellen, streckenruhen, sammelmeldungen] = await Promise.all([
        this.post<RawStoerung[]>('stoerungen', revision),
        this.post<RawBaustelle[]>('baustellen', revision),
        this.post<RawStreckenruhe[]>('streckenruhen', revision),
        this.post<RawStoerung[]>('stoerungen/sammelmeldungen', revision),
      ]);

      const now = new Date();
      const gebaut = baueGeoJson(
        { stoerungen, baustellen, streckenruhen, sammelmeldungen },
        now,
        this.resolveCoord,
        this.verlauf,
      );
      const data: StreckenInfoResult = { ...gebaut, generatedAt: now.toISOString(), error: null };
      this.cache = { data, ts: nowMs };
      try {
        if (this.onRefresh) this.onRefresh(); // nur nach echtem Scrape
      } catch {
        /* Callback-Fehler nicht als Scrape-Fehler werten */
      }
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.cache) return { ...this.cache.data, error: msg };
      return StreckenInfoService.empty(msg, new Date().toISOString());
    }
  }
}
