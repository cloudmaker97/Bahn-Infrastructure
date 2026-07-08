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

/**
 * Verkabelt das Live-Zug-Overlay mit der Karte. Einziger Teil mit Seiteneffekten.
 * @param {{ map: any, L: any, renderer: any, overlayControl: any }} deps
 */
export function initLiveTrips({ map, L, renderer, overlayControl, defaultOn = false }) {
  const API = 'https://api.transitous.org/api/v6/map/trips';
  const MIN_ZOOM = 3;
  const REFETCH_MS = 30000;
  const DEBOUNCE_MS = 400;
  const ANIM_INTERVAL_MS = 200; // Marker ~5x/s bewegen statt pro Frame (Performance)

  const group = L.layerGroup();
  overlayControl.addOverlay(group, 'Live-Züge');

  const trains = new Map(); // id -> { zug, marker }
  let active = false, rafId = null, refetchTimer = null, debounceTimer = null, inFlight = false, lastAnim = 0;

  // Dezente Statuszeile unter der vorhandenen Streckeninfo-/Status-Zeile.
  const statusEl = document.createElement('div');
  statusEl.id = 'ltStatus';
  statusEl.style.cssText = 'font-size:11px;color:var(--muted);margin-top:6px;';
  const anchor = document.getElementById('siStatus') || document.getElementById('status');
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(statusEl, anchor.nextSibling);
  const setStatus = (msg) => { statusEl.textContent = msg; };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function popupHtml(zug) {
    const d = zug.delayMin;
    const delayTxt = d > 0 ? `<span style="color:#d23f3f">+${d} min</span>` : (d < 0 ? `${d} min` : 'pünktlich');
    return `<h3>${esc(zug.name || 'Zug')}</h3><table>` +
      `<tr><td class="k">von → nach</td><td>${esc(zug.fromName)} → ${esc(zug.toName)}</td></tr>` +
      `<tr><td class="k">planmäßig</td><td>ab ${fmt(zug.schedDepartMs)} · an ${fmt(zug.schedArriveMs)}</td></tr>` +
      `<tr><td class="k">aktuell</td><td>ab ${fmt(zug.departMs)} · an ${fmt(zug.arriveMs)}</td></tr>` +
      `<tr><td class="k">Verspätung</td><td>${delayTxt}</td></tr>` +
      `<tr><td class="k">Echtzeit</td><td>${zug.realTime ? 'ja' : 'nein (Plan)'}</td></tr>` +
      `</table>`;
  }

  function markerFor(zug) {
    const color = CATEGORY_COLOR[zug.category] || '#8894a0';
    const m = L.circleMarker([0, 0], { renderer, radius: 5, color: '#ffffff', weight: 1.5, fillColor: color, fillOpacity: 0.95 });
    if (zug.name) m.bindTooltip(zug.name, { direction: 'top', opacity: 0.9 });
    m.bindPopup(() => popupHtml(zug), { maxWidth: 300 });
    return m;
  }

  function clearTrains() { group.clearLayers(); trains.clear(); }

  function syncTrains(list) {
    const seen = new Set();
    for (const zug of list) {
      seen.add(zug.id);
      const existing = trains.get(zug.id);
      if (existing) { existing.zug = zug; } // Zeiten/Track aktualisieren, Marker behalten
      else {
        const marker = markerFor(zug);
        marker.addTo(group);
        trains.set(zug.id, { zug, marker });
      }
    }
    for (const [id, entry] of trains) {
      if (!seen.has(id)) { group.removeLayer(entry.marker); trains.delete(id); }
    }
  }

  async function fetchTrips() {
    if (!active || inFlight) return;
    if (map.getZoom() < MIN_ZOOM) {
      clearTrains();
      setStatus(`Live-Züge: zum Anzeigen näher heranzoomen (ab Zoom ${MIN_ZOOM})`);
      return;
    }
    inFlight = true;
    try {
      const b = map.getBounds();
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const now = new Date();
      const end = new Date(now.getTime() + REFETCH_MS);
      const url = `${API}?min=${sw.lat},${sw.lng}&max=${ne.lat},${ne.lng}` +
        `&startTime=${now.toISOString()}&endTime=${end.toISOString()}&zoom=${map.getZoom()}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const raw = await resp.json();
      const list = normalizeTrips(raw, now.getTime());
      syncTrains(list);
      setStatus(`Live-Züge: ${list.length} im Ausschnitt · Stand ${now.toLocaleTimeString('de-DE')}`);
    } catch (e) {
      setStatus('Live-Züge nicht verfügbar (' + ((e && e.message) || e) + ')');
    } finally {
      inFlight = false;
    }
  }

  // Positionen zeitgetaktet (~5 fps) statt pro Frame aktualisieren: Züge bewegen sich
  // auf der Karte nur wenige Pixel/Sekunde -> deutlich weniger Canvas-Redraws, gleiche Optik.
  function animate(ts) {
    if (!active) { rafId = null; return; }
    const t = ts || 0;
    if (t - lastAnim >= ANIM_INTERVAL_MS) {
      lastAnim = t;
      const now = Date.now();
      for (const { zug, marker } of trains.values()) {
        const span = zug.arriveMs - zug.departMs;
        const frac = span > 0 ? (now - zug.departMs) / span : 0;
        const pos = positionAt(zug.track, frac);
        if (pos) marker.setLatLng(pos);
      }
    }
    rafId = requestAnimationFrame(animate);
  }

  function scheduleRefetch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchTrips, DEBOUNCE_MS);
  }

  function start() {
    if (active) return;
    active = true;
    fetchTrips();
    refetchTimer = setInterval(fetchTrips, REFETCH_MS);
    map.on('moveend zoomend', scheduleRefetch);
    if (rafId == null) rafId = requestAnimationFrame(animate);
  }

  function stop() {
    active = false;
    if (refetchTimer) { clearInterval(refetchTimer); refetchTimer = null; }
    clearTimeout(debounceTimer);
    map.off('moveend zoomend', scheduleRefetch);
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    clearTrains();
    setStatus('');
  }

  map.on('overlayadd', (e) => { if (e.layer === group) start(); });
  map.on('overlayremove', (e) => { if (e.layer === group) stop(); });

  // Im Hintergrund-Tab kein Nachladen (spart Netz/CPU); beim Zurückkehren sofort aktualisieren.
  // (Die rAF-Animation drosselt der Browser im Hintergrund ohnehin automatisch.)
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) {
      if (refetchTimer) { clearInterval(refetchTimer); refetchTimer = null; }
    } else {
      fetchTrips();
      if (!refetchTimer) refetchTimer = setInterval(fetchTrips, REFETCH_MS);
    }
  });

  // Standardmäßig eingeschaltet: Gruppe zur Karte hinzufügen (Häkchen in der
  // Ebenen-Steuerung) und den Loop direkt starten (programmatisches addTo feuert
  // kein 'overlayadd', daher start() explizit).
  if (defaultOn) { group.addTo(map); start(); }
}
