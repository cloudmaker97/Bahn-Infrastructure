// Live-Züge (Echtzeit) für die ISR-Karte.
// Reine, seiteneffektfreie Kernfunktionen + initLiveTrips-Glue (nur Letztere
// nutzt Browser-APIs). ES-Modul, in index.html via <script type="module">.

/**
 * Dekodiert eine Google-Encoded-Polyline zu [[lat, lon], …].
 * @param {string} str  kodierte Polyline
 * @param {number} precision  Nachkommastellen-Faktor (Transitous: 5)
 * @returns {[number, number][]}
 */
export function decodePolyline(str, precision = 5) {
  let idx = 0, lat = 0, lon = 0;
  const out = [];
  const f = Math.pow(10, precision);
  while (idx < str.length) {
    let b, shift = 0, res = 0;
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);
    shift = 0; res = 0;
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += (res & 1) ? ~(res >> 1) : (res >> 1);
    out.push([lat / f, lon / f]);
  }
  return out;
}

/** Näherungsdistanz zweier [lat,lon] (äquirektangulär, nur zur Parametrisierung). */
function segDist(a, b) {
  const dLat = b[0] - a[0];
  const dLon = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Baut aus einer Punktliste die kumulativen Distanzen für die Interpolation.
 * @param {[number,number][]} coords
 * @returns {{ points: [number,number][], cumDist: number[], total: number }}
 */
export function buildTrack(coords) {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + segDist(coords[i - 1], coords[i]));
  }
  return { points: coords, cumDist, total: cumDist.length ? cumDist[cumDist.length - 1] : 0 };
}

/**
 * Position bei Anteil `frac` (0..1) der Gesamtlänge; linear zwischen Stützpunkten.
 * Klemmt `frac` auf [0, 1]. Gibt null bei leerem Track.
 * @returns {[number,number]|null}
 */
export function positionAt(track, frac) {
  const pts = track.points;
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  const f = frac <= 0 ? 0 : frac >= 1 ? 1 : frac;
  const target = f * track.total;
  const cd = track.cumDist;
  let i = 1;
  while (i < cd.length && cd[i] < target) i++;
  if (i >= cd.length) return pts[pts.length - 1];
  const segStart = cd[i - 1];
  const segLen = (cd[i] - segStart) || 1;
  const t = (target - segStart) / segLen;
  const a = pts[i - 1], b = pts[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Eisenbahn-Modi (alles andere – Bus, U-Bahn, Tram, Fähre – wird verworfen). */
export const RAIL_MODES = new Set([
  'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL',
  'REGIONAL_RAIL', 'REGIONAL_FAST_RAIL', 'SUBURBAN',
]);

/** @param {string} mode @returns {boolean} */
export function isRailMode(mode) {
  return RAIL_MODES.has(mode);
}

/** Grobkategorie für die Farbwahl. @returns {'fern'|'regio'|'sbahn'|'other'} */
export function categoryOf(mode) {
  if (mode === 'HIGHSPEED_RAIL' || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL') return 'fern';
  if (mode === 'REGIONAL_RAIL' || mode === 'REGIONAL_FAST_RAIL') return 'regio';
  if (mode === 'SUBURBAN') return 'sbahn';
  return 'other';
}

/** Kategorie-Farben, abgesetzt von den Infrastruktur-Overlays. */
export const CATEGORY_COLOR = { fern: '#d23f3f', regio: '#2ec76b', sbahn: '#2f7fe0' };

/**
 * Wandelt die Roh-Segmente von map/trips in normalisierte Zug-Objekte.
 * Verwirft Nicht-Eisenbahn, ungültige Zeiten und undekodierbare Polylinien.
 * @param {any[]} rawArray
 * @param {number} nowMs  (reserviert; aktuell ohne Wirkung auf das Ergebnis)
 * @returns {object[]}
 */
export function normalizeTrips(rawArray, nowMs) {
  const out = [];
  if (!Array.isArray(rawArray)) return out;
  for (const seg of rawArray) {
    if (!seg || !isRailMode(seg.mode)) continue;
    const departMs = Date.parse(seg.departure);
    const arriveMs = Date.parse(seg.arrival);
    if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs <= departMs) continue;
    if (typeof seg.polyline !== 'string' || seg.polyline.length === 0) continue;
    const coords = decodePolyline(seg.polyline);
    if (coords.length < 2) continue;

    const trip = (Array.isArray(seg.trips) && seg.trips[0]) ? seg.trips[0] : {};
    const schedDepartMs = Date.parse(seg.scheduledDeparture);
    const schedArriveMs = Date.parse(seg.scheduledArrival);
    const delayMin = Number.isFinite(schedDepartMs) ? Math.round((departMs - schedDepartMs) / 60000) : 0;

    out.push({
      id: `${trip.tripId || seg.mode}@${departMs}`,
      name: trip.displayName || '',
      mode: seg.mode,
      category: categoryOf(seg.mode),
      track: buildTrack(coords),
      departMs,
      arriveMs,
      schedDepartMs: Number.isFinite(schedDepartMs) ? schedDepartMs : departMs,
      schedArriveMs: Number.isFinite(schedArriveMs) ? schedArriveMs : arriveMs,
      delayMin,
      realTime: seg.realTime === true,
      fromName: (seg.from && seg.from.name) || '',
      toName: (seg.to && seg.to.name) || '',
    });
  }
  return out;
}
