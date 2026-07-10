// Pure transforms of the network status (strecken-info.de): coordinate
// conversion, active filter, GeoJSON/DTO building. Separated from network/cache
// (service.ts) so everything here is testable without network access.
import type {
  AlignmentLookup,
  FeatureCollection,
  GeoFeature,
  SammelmeldungDTO,
  StoerungMeldungDTO,
  StreckenInfoResult,
} from '../../types.js';
import type {
  CoordResolver,
  RawConstructionSite,
  RawDisruption,
  RawEffect,
  RawLineClosure,
  RawNetworkStatus,
  RawSection,
  RawValidity,
  RawPeriod,
} from './wire.js';

// --- Pure geo function: EPSG:3857 (web mercator) -> WGS84 ---

/** Converts a web-mercator point to WGS84. Returns [lon, lat] (GeoJSON order). */
export function mercatorToWgs84(x: number, y: number): [number, number] {
  const R = 6378137;
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

// --- Pure time helpers (all API times are naive local time Europe/Berlin) ---

// getDay() 0=Sunday..6=Saturday -> German weekday name (API wire values).
const WEEKDAYS = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG'] as const;

/** Local date as "YYYY-MM-DD" (lexicographically comparable). */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local time as "HH:MM:SS" (lexicographically comparable). */
function localTimeStr(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}`;
}

/** Parses a naive ISO local time ("YYYY-MM-DDTHH:MM:SS") as a local Date, or null. */
function parseNaiveLocal(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Checks whether a single validity window covers the instant `now`. */
function validityCovers(g: RawValidity, now: Date): boolean {
  // 1. Date within [vonDatum, bisDatum] (inclusive, lexicographic for YYYY-MM-DD).
  const today = localDateStr(now);
  if (g.vonDatum && today < g.vonDatum) return false;
  if (g.bisDatum && today > g.bisDatum) return false;

  // 2. The weekday must be included.
  const weekday = WEEKDAYS[now.getDay()]!;
  if (g.wochentage && g.wochentage.length > 0 && !g.wochentage.includes(weekday)) return false;

  // 3. Time of day within [vonUhrzeit, bisUhrzeit].
  const from = g.vonUhrzeit;
  const to = g.bisUhrzeit;
  if (from && to) {
    const nowTime = localTimeStr(now);
    if (from <= to) {
      // Normal window within one day.
      if (nowTime < from || nowTime > to) return false;
    } else {
      // Window across midnight (e.g. 20:00-04:00): active when >= from OR <= to.
      if (nowTime < from && nowTime > to) return false;
    }
  }
  return true;
}

/**
 * Pure: is an item active NOW?
 * - With `gueltigkeiten` (construction sites, line closures): active when ANY window covers `now`.
 * - Without `gueltigkeiten` (disruptions): active when `now` is within [zeitraum.beginn,
 *   zeitraum.ende] AND neither `abgelaufen` nor `geschlossen` is set.
 */
export function isCurrentlyActive(item: unknown, now: Date): boolean {
  const it = item as {
    gueltigkeiten?: RawValidity[];
    zeitraum?: RawPeriod;
    abgelaufen?: boolean;
    geschlossen?: boolean;
  };

  if (Array.isArray(it.gueltigkeiten) && it.gueltigkeiten.length > 0) {
    return it.gueltigkeiten.some((g) => validityCovers(g, now));
  }

  // Disruptions: period + status flags.
  if (it.abgelaufen === true || it.geschlossen === true) return false;
  const start = parseNaiveLocal(it.zeitraum?.beginn);
  const end = parseNaiveLocal(it.zeitraum?.ende);
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

// --- Pure GeoJSON building helpers ---

/** Builds a FeatureCollection from finished features. */
function featureCollection(features: GeoFeature[]): FeatureCollection {
  return { type: 'FeatureCollection', features, totalFeatures: features.length };
}

/** Chooses Point (1 coordinate) or LineString (>=2); null for an empty list. */
function lineOrPoint(coords: [number, number][]): GeoFeature['geometry'] {
  if (coords.length === 0) return null;
  if (coords.length === 1) return { type: 'Point', coordinates: coords[0]! };
  return { type: 'LineString', coordinates: coords };
}

/** Flattens the transport modes of all effects into one deduplicated list. */
function flattenTransportModes(effects: RawEffect[] | undefined): string[] {
  const set = new Set<string>();
  for (const w of effects ?? []) {
    for (const v of w.verkehrsarten ?? []) set.add(v);
  }
  return [...set];
}

/**
 * Locates the `abschnitte` of a disruption via RL100 into segments
 * (MultiLineString/LineString) along the real track alignment (resolveAlignment,
 * otherwise straight line). Direction duplicates (A->B + B->A) are drawn only
 * once; sections with only one resolvable end contribute a point.
 * Additionally returns `routed`: true as soon as at least one section produced
 * a track-accurate chain (instead of a straight line) – this decides whether the
 * result may beat a direct 2-point straight line from `koordinaten`.
 * Null when no section was locatable.
 */
function sectionsGeometry(
  sections: RawSection[],
  resolveCoord: CoordResolver,
  resolveAlignment?: AlignmentLookup,
): { geometry: GeoFeature['geometry']; routed: boolean } | null {
  const segments: [number, number][][] = [];
  const points: [number, number][] = [];
  const seen = new Set<string>();
  let routed = false;
  for (const a of sections) {
    const fromRil = a.von?.ril100;
    const toRil = a.bis?.ril100;
    const from = fromRil ? resolveCoord(fromRil) : null;
    const to = toRil ? resolveCoord(toRil) : null;
    if (fromRil && toRil) {
      const key = [fromRil.trim(), toRil.trim()].sort().join('>') + `@${a.streckennummer ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The alignment depends only on the RIL codes (the resolver knows the
      // sub-station fallback), NOT on resolveCoord – otherwise sections with
      // station-part ends would degrade to a point although they are routable.
      const alignment = resolveAlignment
        ? resolveAlignment(fromRil, toRil, a.streckennummer != null ? [a.streckennummer] : undefined)
        : null;
      if (alignment) { segments.push(alignment); routed = true; continue; }
    }
    if (from && to) segments.push([from, to]);
    else if (from) points.push(from);
    else if (to) points.push(to);
  }
  if (segments.length > 0) {
    // The geometry union has no mixed type; single points therefore join the
    // MultiLineString as degenerate segments [p,p].
    for (const p of points) segments.push([p, p]);
    const geometry: GeoFeature['geometry'] = segments.length === 1
      ? { type: 'LineString', coordinates: segments[0]! }
      : { type: 'MultiLineString', coordinates: segments };
    return { geometry, routed };
  }
  if (points.length === 1) return { geometry: { type: 'Point', coordinates: points[0]! }, routed: false };
  if (points.length > 1) return { geometry: { type: 'MultiPoint', coordinates: points }, routed: false };
  return null;
}

/**
 * Determines the geometry of a disruption with a fallback cascade:
 *  a) `koordinaten` (mercator) -> LineString/Point. A 2-point `koordinaten` line
 *     is itself a straight line though: when the `abschnitte` yield a
 *     track-accurate alignment, that wins (strecken-info often delivers only the
 *     two endpoints);
 *  b) otherwise `abschnitte` via RL100 -> track alignment (see sectionsGeometry);
 *  c) otherwise `betriebsstellen` via RL100 -> MultiPoint/Point;
 *  d) otherwise null (not locatable).
 */
function disruptionGeometry(
  s: RawDisruption,
  resolveCoord: CoordResolver,
  resolveAlignment?: AlignmentLookup,
): GeoFeature['geometry'] {
  const sections = s.abschnitte ?? [];

  // a) Direct mercator coordinates.
  const coords = (s.koordinaten ?? []).map((p) => mercatorToWgs84(p.x, p.y));
  if (coords.length > 0) {
    // Exactly two points = straight line. When the sections route
    // track-accurately, the real alignment wins; otherwise the koordinaten
    // stay (no regression).
    if (coords.length === 2 && sections.length > 0) {
      const fromSections = sectionsGeometry(sections, resolveCoord, resolveAlignment);
      if (fromSections?.routed) return fromSections.geometry;
    }
    return lineOrPoint(coords);
  }

  // b) Sections via RL100 (as before: existing sections "win" – when they are
  //    not locatable the result stays null instead of falling through to c).
  if (sections.length > 0) {
    return sectionsGeometry(sections, resolveCoord, resolveAlignment)?.geometry ?? null;
  }

  // c) Operating points via RL100.
  const operatingPoints = s.betriebsstellen ?? [];
  if (operatingPoints.length > 0) {
    const points: [number, number][] = [];
    for (const b of operatingPoints) {
      const c = b.ril100 ? resolveCoord(b.ril100) : null;
      if (c) points.push(c);
    }
    if (points.length === 1) return { type: 'Point', coordinates: points[0]! };
    if (points.length > 1) return { type: 'MultiPoint', coordinates: points };
  }

  // d) Not locatable.
  return null;
}

/** Pure: one disruption -> GeoFeature (geometry via fallback cascade, possibly null). */
export function toDisruptionFeature(
  s: RawDisruption,
  resolveCoord: CoordResolver,
  resolveAlignment?: AlignmentLookup,
): GeoFeature {
  return {
    type: 'Feature',
    geometry: disruptionGeometry(s, resolveCoord, resolveAlignment),
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
 * Pure: one construction site -> GeoFeature (Point when from==to; otherwise the
 * real track alignment via resolveAlignment, fallback straight line [from,to]).
 */
export function toConstructionFeature(b: RawConstructionSite, resolveAlignment?: AlignmentLookup): GeoFeature {
  const from = b.koordinaten?.von;
  const to = b.koordinaten?.bis;
  const coords: [number, number][] = [];
  if (from) coords.push(mercatorToWgs84(from.x, from.y));
  if (to && !(from && from.x === to.x && from.y === to.y)) coords.push(mercatorToWgs84(to.x, to.y));
  let geometry = lineOrPoint(coords);
  if (coords.length === 2 && resolveAlignment && b.ril100Von && b.ril100Bis) {
    const alignment = resolveAlignment(b.ril100Von, b.ril100Bis, b.streckennummern);
    if (alignment) geometry = { type: 'LineString', coordinates: alignment };
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

/** Pure: one line closure -> GeoFeature (Point). */
export function toClosureFeature(r: RawLineClosure): GeoFeature {
  const k = r.koordinaten;
  const coords: [number, number][] = k ? [mercatorToWgs84(k.x, k.y)] : [];
  return {
    type: 'Feature',
    geometry: lineOrPoint(coords),
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

/** Pure: one disruption -> text DTO for lists/TUI (geometry-independent). */
export function toDisruptionNoticeDto(s: RawDisruption, located: boolean): StoerungMeldungDTO {
  return {
    key: s.key ?? '',
    cause: s.cause ?? '',
    subcause: s.subcause ?? '',
    text: s.text ?? '',
    beginn: s.zeitraum?.beginn ?? '',
    ende: s.zeitraum?.ende ?? '',
    verkehrsarten: flattenTransportModes(s.wirkungenMitVerkehrsarten),
    gleisEinschraenkung: s.gleisEinschraenkung ?? '',
    verortet: located,
  };
}

/** Pure: one aggregate notice -> DTO for the panel list. */
export function toAggregateNoticeDto(s: RawDisruption): SammelmeldungDTO {
  return {
    key: s.key ?? '',
    cause: s.cause ?? '',
    subcause: s.subcause ?? '',
    text: s.text ?? '',
    beginn: s.zeitraum?.beginn ?? '',
    ende: s.zeitraum?.ende ?? '',
    verkehrsarten: flattenTransportModes(s.wirkungenMitVerkehrsarten),
  };
}

/**
 * Central, purely testable function: builds the StreckenInfoResult (without
 * generatedAt/error) from the four raw arrays. Filters for "currently active"
 * and (for disruptions) for located non-aggregate notices.
 */
export function buildGeoJson(
  raw: RawNetworkStatus,
  now: Date,
  resolveCoord: CoordResolver,
  resolveAlignment?: AlignmentLookup,
): Omit<StreckenInfoResult, 'generatedAt' | 'error'> {
  const rawDisruptions = Array.isArray(raw.stoerungen) ? raw.stoerungen : [];
  const rawConstructionSites = Array.isArray(raw.baustellen) ? raw.baustellen : [];
  const rawClosures = Array.isArray(raw.streckenruhen) ? raw.streckenruhen : [];
  const rawAggregates = Array.isArray(raw.sammelmeldungen) ? raw.sammelmeldungen : [];

  // Disruptions: non-aggregate notices, currently active; geometry via fallback cascade.
  const activeDisruptions = rawDisruptions.filter(
    (s) => s.sammelmeldung !== true && isCurrentlyActive(s, now),
  );
  const allDisruptionFeatures = activeDisruptions.map((s) => toDisruptionFeature(s, resolveCoord, resolveAlignment));
  // Only located features go onto the map; count null geometries separately.
  const locatedDisruptions = allDisruptionFeatures.filter((f) => f.geometry !== null);
  const unlocatedCount = allDisruptionFeatures.length - locatedDisruptions.length;
  // Text list of ALL active disruptions (located flag from the built geometry).
  const disruptionNotices = activeDisruptions.map((s, i) =>
    toDisruptionNoticeDto(s, allDisruptionFeatures[i]!.geometry !== null),
  );

  const constructionFeatures = rawConstructionSites
    .filter((b) => isCurrentlyActive(b, now))
    .map((b) => toConstructionFeature(b, resolveAlignment));

  const closureFeatures = rawClosures
    .filter((r) => isCurrentlyActive(r, now))
    .map(toClosureFeature);

  const aggregateNotices = rawAggregates.map(toAggregateNoticeDto);

  return {
    stoerungen: featureCollection(locatedDisruptions),
    baustellen: featureCollection(constructionFeatures),
    streckenruhen: featureCollection(closureFeatures),
    sammelmeldungen: aggregateNotices,
    stoerungenListe: disruptionNotices,
    counts: {
      stoerungen: locatedDisruptions.length,
      stoerungenOhneOrt: unlocatedCount,
      baustellen: constructionFeatures.length,
      streckenruhen: closureFeatures.length,
      sammelmeldungen: aggregateNotices.length,
    },
  };
}
