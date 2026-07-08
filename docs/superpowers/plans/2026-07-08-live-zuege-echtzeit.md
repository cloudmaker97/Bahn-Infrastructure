# Live-Züge (Echtzeit-Karte) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fahrende Eisenbahn-Züge in Echtzeit als flüssig bewegte Marker auf der bestehenden Leaflet-Karte anzeigen, gespeist aus dem Transitous/MOTIS-Endpunkt `map/trips`.

**Architecture:** Reines Frontend. Neue ES-Modul-Datei `public/live-trips.js` mit seiteneffektfreien Kernfunktionen (Polyline-Dekodierung, Track-/Positions-Interpolation, Modus-Filter, Normalisierung) und einer `initLiveTrips`-Glue-Funktion (Leaflet-Layer, Fetch, `requestAnimationFrame`-Loop). `index.html` bindet das Modul ein. Die Kernfunktionen werden per Node-Selbsttest (`.mjs`, via `tsx`) geprüft und in die CI gehängt.

**Tech Stack:** TypeScript-Projekt (Server/TUI), Vanilla-JS + Leaflet 1.9 (Frontend), `tsx` für Selbsttests, GitHub Actions CI.

## Global Constraints

- Kommentare und UI-Texte auf **Deutsch**, volle Umlaut-/Diakritika-Korrektheit (z. B. „Verspätung", „Züge"), nie ASCII-Ersatz.
- **Kein Backend-Proxy, keine neue Server-Abhängigkeit** — direkter Browser-Fetch an `https://api.transitous.org/api/v6/map/trips` (CORS: `Access-Control-Allow-Origin: *`).
- Nur **Eisenbahn**-Modi: `HIGHSPEED_RAIL`, `LONG_DISTANCE`, `NIGHT_RAIL`, `REGIONAL_RAIL`, `REGIONAL_FAST_RAIL`, `SUBURBAN`. Alles andere (Bus, U-Bahn, Tram, Fähre …) verwerfen.
- Polyline-Präzision **5** (Standard-Google-Polyline).
- Zeiten in der API sind **UTC-ISO** → `Date.parse()` liefert Millisekunden.
- Kategorie-Farben: Fern `#d23f3f` (rot), Regio `#2ec76b` (grün), S-Bahn `#2f7fe0` (blau).
- Konstanten: Zoom-Schwelle **9**, Refetch-Intervall **30000 ms**, Debounce **400 ms**.
- `tsconfig.json` wird **nicht** geändert. Der Selbsttest ist `public/live-trips.selftest.mjs` (nicht unter `src/`, daher von `tsc` unberührt), lauffähig mit `npx tsx public/live-trips.selftest.mjs`.
- `public/live-trips.js` darf auf Modul-Ebene **keine** Browser-Globals (`document`, `window`, `requestAnimationFrame`, `fetch`) ausführen — nur innerhalb von `initLiveTrips`. So bleibt das Modul in Node importierbar.

---

### Task 1: Kernmodul + Polyline-Dekodierung

**Files:**
- Create: `public/live-trips.js`
- Create: `public/live-trips.selftest.mjs`
- Modify: `.github/workflows/ci.yml` (CI-Schritt ergänzen)

**Interfaces:**
- Produces: `decodePolyline(str: string, precision = 5): [number, number][]` — Liste `[lat, lon]`.

- [ ] **Step 1: Failing test schreiben**

`public/live-trips.selftest.mjs`:

```js
// Selbsttest der reinen Live-Zug-Kernfunktionen (ohne Netz/Browser).
// Laufbar mit: npx tsx public/live-trips.selftest.mjs
import assert from 'node:assert';
import { decodePolyline } from './live-trips.js';

// --- 1) decodePolyline (Standard-Google-Testvektor, Präzision 5) ---
{
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.strictEqual(pts.length, 3, 'drei Punkte erwartet');
  assert.ok(Math.abs(pts[0][0] - 38.5) < 1e-5 && Math.abs(pts[0][1] + 120.2) < 1e-5, 'Punkt 1');
  assert.ok(Math.abs(pts[1][0] - 40.7) < 1e-5 && Math.abs(pts[1][1] + 120.95) < 1e-5, 'Punkt 2');
  assert.ok(Math.abs(pts[2][0] - 43.252) < 1e-5 && Math.abs(pts[2][1] + 126.453) < 1e-5, 'Punkt 3');
}

console.log('live-trips selftest: OK');
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: FAIL — `Cannot find module './live-trips.js'` (Datei existiert noch nicht).

- [ ] **Step 3: Minimale Implementierung**

`public/live-trips.js`:

```js
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
```

- [ ] **Step 4: Test ausführen, Erfolg prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: PASS — Ausgabe `live-trips selftest: OK`.

- [ ] **Step 5: CI-Schritt ergänzen**

In `.github/workflows/ci.yml` nach dem TUI-Selftest-Schritt anfügen (gleiche Einrückung wie die anderen Schritte):

```yaml
      - name: Selftest – Live-Züge
        run: npx tsx public/live-trips.selftest.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/live-trips.js public/live-trips.selftest.mjs .github/workflows/ci.yml
git commit -m "feat(web): Live-Züge – Polyline-Dekodierung + Selbsttest/CI"
```

---

### Task 2: Track-Aufbau und Positions-Interpolation

**Files:**
- Modify: `public/live-trips.js`
- Modify: `public/live-trips.selftest.mjs`

**Interfaces:**
- Consumes: nichts aus Task 1 (eigenständig).
- Produces:
  - `buildTrack(coords: [number,number][]): { points: [number,number][], cumDist: number[], total: number }`
  - `positionAt(track, frac: number): [number, number] | null` — interpolierte Position; `frac` wird auf [0, 1] geklemmt.

- [ ] **Step 1: Failing test ergänzen**

In `public/live-trips.selftest.mjs` den Import erweitern und einen Block vor `console.log(...)` einfügen:

```js
// Import-Zeile ersetzen durch:
import { decodePolyline, buildTrack, positionAt } from './live-trips.js';

// --- 2) buildTrack / positionAt ---
{
  const track = buildTrack([[0, 0], [0, 10]]);
  assert.ok(Math.abs(track.total - 10) < 1e-6, 'Gesamtlänge ~10');
  assert.deepStrictEqual(positionAt(track, 0), [0, 0], 'frac 0 -> Start');
  assert.deepStrictEqual(positionAt(track, 1), [0, 10], 'frac 1 -> Ende');
  const mid = positionAt(track, 0.5);
  assert.ok(Math.abs(mid[0]) < 1e-6 && Math.abs(mid[1] - 5) < 1e-6, 'frac 0.5 -> Mitte');
  assert.deepStrictEqual(positionAt(track, -1), [0, 0], 'Klemmung unten');
  assert.deepStrictEqual(positionAt(track, 2), [0, 10], 'Klemmung oben');

  const drei = buildTrack([[0, 0], [0, 10], [0, 20]]);
  assert.ok(Math.abs(positionAt(drei, 0.5)[1] - 10) < 1e-6, 'gleichmäßiger 3-Punkt-Track: Mitte bei 10');
}
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: FAIL — `buildTrack is not a function` (bzw. Import-Fehler).

- [ ] **Step 3: Implementierung ergänzen**

In `public/live-trips.js` anhängen:

```js
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
```

- [ ] **Step 4: Test ausführen, Erfolg prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: PASS — `live-trips selftest: OK`.

- [ ] **Step 5: Commit**

```bash
git add public/live-trips.js public/live-trips.selftest.mjs
git commit -m "feat(web): Live-Züge – Track-Aufbau + Positions-Interpolation"
```

---

### Task 3: Modus-Filter und Kategorie-Zuordnung

**Files:**
- Modify: `public/live-trips.js`
- Modify: `public/live-trips.selftest.mjs`

**Interfaces:**
- Produces:
  - `isRailMode(mode: string): boolean`
  - `categoryOf(mode: string): 'fern' | 'regio' | 'sbahn' | 'other'`
  - `CATEGORY_COLOR: Record<'fern'|'regio'|'sbahn', string>`

- [ ] **Step 1: Failing test ergänzen**

Import in `public/live-trips.selftest.mjs` erweitern und Block einfügen:

```js
// Import-Zeile ersetzen durch:
import { decodePolyline, buildTrack, positionAt, isRailMode, categoryOf } from './live-trips.js';

// --- 3) isRailMode / categoryOf ---
{
  assert.ok(isRailMode('HIGHSPEED_RAIL'), 'ICE ist Bahn');
  assert.ok(isRailMode('REGIONAL_RAIL'), 'Regio ist Bahn');
  assert.ok(isRailMode('SUBURBAN'), 'S-Bahn ist Bahn');
  assert.ok(!isRailMode('BUS'), 'Bus ist keine Bahn');
  assert.ok(!isRailMode('SUBWAY'), 'U-Bahn ausgeschlossen');
  assert.ok(!isRailMode('FERRY'), 'Fähre ausgeschlossen');
  assert.strictEqual(categoryOf('HIGHSPEED_RAIL'), 'fern');
  assert.strictEqual(categoryOf('LONG_DISTANCE'), 'fern');
  assert.strictEqual(categoryOf('REGIONAL_RAIL'), 'regio');
  assert.strictEqual(categoryOf('SUBURBAN'), 'sbahn');
}
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: FAIL — `isRailMode is not a function`.

- [ ] **Step 3: Implementierung ergänzen**

In `public/live-trips.js` anhängen:

```js
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
```

- [ ] **Step 4: Test ausführen, Erfolg prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/live-trips.js public/live-trips.selftest.mjs
git commit -m "feat(web): Live-Züge – Eisenbahn-Filter + Kategorie-Farben"
```

---

### Task 4: Normalisierung der Roh-Segmente

**Files:**
- Modify: `public/live-trips.js`
- Modify: `public/live-trips.selftest.mjs`

**Interfaces:**
- Consumes: `decodePolyline`, `buildTrack`, `isRailMode`, `categoryOf` (Tasks 1–3).
- Produces: `normalizeTrips(rawArray: any[], nowMs: number): Zug[]` mit
  `Zug = { id, name, mode, category, track, departMs, arriveMs, schedDepartMs, schedArriveMs, delayMin, realTime, fromName, toName }`.
  Verwirft Nicht-Eisenbahn, Segmente ohne gültige Zeiten (`arriveMs <= departMs`) und ohne dekodierbare Polyline (`< 2` Punkte). `nowMs` ist derzeit nur Signatur-Bestandteil (für spätere Fensterlogik reserviert) und beeinflusst das Ergebnis nicht.

- [ ] **Step 1: Failing test ergänzen**

Import erweitern und Block einfügen:

```js
// Import-Zeile ersetzen durch:
import { decodePolyline, buildTrack, positionAt, isRailMode, categoryOf, normalizeTrips } from './live-trips.js';

// --- 4) normalizeTrips ---
{
  const raw = [
    { mode: 'BUS', departure: '2026-07-08T18:00:00Z', arrival: '2026-07-08T18:30:00Z',
      polyline: '_p~iF~ps|U_ulLnnqC', trips: [{ tripId: 'b1', displayName: 'Bus 1' }] },
    { mode: 'HIGHSPEED_RAIL', departure: '2026-07-08T18:29:00Z', arrival: '2026-07-08T19:00:00Z',
      scheduledDeparture: '2026-07-08T18:26:00Z', scheduledArrival: '2026-07-08T18:57:00Z',
      realTime: true, polyline: '_p~iF~ps|U_ulLnnqC', from: { name: 'A-Stadt' }, to: { name: 'B-Dorf' },
      trips: [{ tripId: 't1', displayName: 'ICE 542' }] },
    { mode: 'REGIONAL_RAIL', departure: '2026-07-08T19:00:00Z', arrival: '2026-07-08T18:00:00Z',
      polyline: '_p~iF~ps|U_ulLnnqC', trips: [{ tripId: 'bad' }] }, // arrival <= departure
    { mode: 'REGIONAL_RAIL', departure: '2026-07-08T18:10:00Z', arrival: '2026-07-08T18:40:00Z',
      polyline: '', trips: [{ tripId: 'nopoly' }] }, // keine Polyline
  ];
  const list = normalizeTrips(raw, Date.parse('2026-07-08T18:40:00Z'));
  assert.strictEqual(list.length, 1, 'nur der gültige Bahn-Zug bleibt');
  const z = list[0];
  assert.strictEqual(z.name, 'ICE 542');
  assert.strictEqual(z.category, 'fern');
  assert.strictEqual(z.delayMin, 3, 'Verspätung 3 min');
  assert.strictEqual(z.realTime, true);
  assert.strictEqual(z.fromName, 'A-Stadt');
  assert.strictEqual(z.toName, 'B-Dorf');
  assert.ok(z.track.points.length >= 2, 'Track hat >= 2 Punkte');
  assert.ok(typeof z.id === 'string' && z.id.length > 0, 'id gesetzt');
}
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: FAIL — `normalizeTrips is not a function`.

- [ ] **Step 3: Implementierung ergänzen**

In `public/live-trips.js` anhängen:

```js
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
```

- [ ] **Step 4: Test ausführen, Erfolg prüfen**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/live-trips.js public/live-trips.selftest.mjs
git commit -m "feat(web): Live-Züge – Normalisierung der Roh-Segmente"
```

---

### Task 5: Glue – Leaflet-Layer, Fetch, Animation (`initLiveTrips`) + Einbindung

**Files:**
- Modify: `public/live-trips.js`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `normalizeTrips`, `positionAt`, `CATEGORY_COLOR`.
- Produces: `initLiveTrips({ map, L, renderer, overlayControl }): void` — registriert das Overlay „Live-Züge" und verkabelt Fetch/Animation. Wird nur im Browser aufgerufen; kein Selbsttest (DOM/Netz), Verifikation end-to-end in Task 6.

- [ ] **Step 1: `initLiveTrips` implementieren**

In `public/live-trips.js` anhängen:

```js
/**
 * Verkabelt das Live-Zug-Overlay mit der Karte. Einziger Teil mit Seiteneffekten.
 * @param {{ map: any, L: any, renderer: any, overlayControl: any }} deps
 */
export function initLiveTrips({ map, L, renderer, overlayControl }) {
  const API = 'https://api.transitous.org/api/v6/map/trips';
  const MIN_ZOOM = 9;
  const REFETCH_MS = 30000;
  const DEBOUNCE_MS = 400;

  const group = L.layerGroup();
  overlayControl.addOverlay(group, 'Live-Züge');

  const trains = new Map(); // id -> { zug, marker }
  let active = false, rafId = null, refetchTimer = null, debounceTimer = null, inFlight = false;

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

  function animate() {
    if (!active) { rafId = null; return; }
    const now = Date.now();
    for (const { zug, marker } of trains.values()) {
      const span = zug.arriveMs - zug.departMs;
      const frac = span > 0 ? (now - zug.departMs) / span : 0;
      const pos = positionAt(zug.track, frac);
      if (pos) marker.setLatLng(pos);
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
}
```

- [ ] **Step 2: Shared-Objekt in `index.html` bereitstellen**

In `public/index.html` direkt nach der Zeile, die `overlayControl` erzeugt
(`const overlayControl = L.control.layers(null, {}, { collapsed: narrowVP, position: 'topright' }).addTo(map);`),
diese Zeile einfügen:

```js
  // Für das Live-Züge-Modul (separates ES-Modul) die geteilten Objekte bereitstellen.
  window.__ISR_MAP__ = { map, renderer, overlayControl };
```

- [ ] **Step 3: Modul einbinden**

In `public/index.html` unmittelbar vor `</body>` (nach dem schließenden `</script>` des Haupt-Skripts) einfügen:

```html
  <script type="module">
    import { initLiveTrips } from './live-trips.js';
    const ctx = window.__ISR_MAP__;
    if (ctx) initLiveTrips({ map: ctx.map, L: window.L, renderer: ctx.renderer, overlayControl: ctx.overlayControl });
  </script>
```

- [ ] **Step 4: Reine Funktionen nicht gebrochen — Selbsttest erneut**

Run: `npx tsx public/live-trips.selftest.mjs`
Expected: PASS (die neue Glue-Funktion wird importiert, aber nicht ausgeführt; der Import darf nicht scheitern).

- [ ] **Step 5: Commit**

```bash
git add public/live-trips.js public/index.html
git commit -m "feat(web): Live-Züge – Overlay, Fetch, flüssige Animation + Einbindung"
```

---

### Task 6: Integrations-Verifikation

**Files:**
- Keine Änderung (reine Verifikation; nur bei gefundenen Fehlern zurück in die betroffene Datei).

**Interfaces:**
- Consumes: das Gesamtsystem.

- [ ] **Step 1: Typecheck (darf durch die neuen JS/MJS-Dateien nicht brechen)**

Run: `npm run typecheck`
Expected: kein Fehler (public/ ist nicht Teil von `tsc`).

- [ ] **Step 2: Alle Selbsttests grün**

Run:
```bash
npx tsx public/live-trips.selftest.mjs
npx tsx src/data/streckeninfo.selftest.ts
npx tsx src/server/sse-hub.selftest.ts
npx tsx src/tui/tui.selftest.ts
```
Expected: alle PASS (der Live-Züge-Test gibt `live-trips selftest: OK`).

- [ ] **Step 3: App starten und Overlay end-to-end prüfen**

Server starten (`npm start`), im Browser (oder per Playwright) die Karte öffnen, in der Ebenen-Steuerung „Live-Züge" einschalten und in einen Ballungsraum zoomen (z. B. Hamburg/Hannover, Zoom ≥ 9). Erwartet:
- ICE/RE/S-Bahn-Marker erscheinen und bewegen sich flüssig entlang der Strecken (rot/grün/blau).
- Popup je Zug zeigt Linie, von → nach, planmäßig/aktuell, Verspätung, Echtzeit.
- Bei Zoom < 9 erscheint der Hinweis „zum Anzeigen näher heranzoomen"; keine Marker.
- Overlay ausschalten entfernt alle Marker und stoppt die Animation.
- Bei Netzfehler bleibt die Karte bedienbar; Statuszeile meldet „Live-Züge nicht verfügbar".

- [ ] **Step 4: Abschluss-Commit (falls in Step 3 Korrekturen nötig waren)**

```bash
git add -A
git commit -m "fix(web): Live-Züge – Korrekturen aus der Integrations-Verifikation"
```

---

## Self-Review

**Spec-Abdeckung:**
- Datenquelle/Parameter/Direkt-Fetch → Task 5 (`fetchTrips`). ✓
- Polyline-Präzision 5 → Task 1. ✓
- rAF-Animation/Interpolation → Task 2 (`positionAt`) + Task 5 (`animate`). ✓
- Eisenbahn-Filter + Farben → Task 3. ✓
- Normalisierung inkl. Verspätung → Task 4. ✓
- Overlay, Popup, Statuszeile, Zoom-Gate, Refetch/Debounce, Fehlerbehandlung → Task 5. ✓
- Einbindung in index.html (Shared-Objekt + Modul-Script) → Task 5. ✓
- Node-Selbsttest + CI → Task 1 (Datei+CI), erweitert in 2–4. ✓
- End-to-End-Verifikation → Task 6. ✓
- Abweichung von der Spec: statt `tsconfig`-`allowJs` wird der Selbsttest als `public/live-trips.selftest.mjs` geführt (nicht unter `src/`, daher kein tsc-Eingriff). Robuster, gleiche Testabdeckung.

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code. ✓

**Typ-Konsistenz:** `decodePolyline`, `buildTrack`, `positionAt`, `isRailMode`, `categoryOf`, `CATEGORY_COLOR`, `normalizeTrips`, `initLiveTrips` durchgängig gleich benannt; `Zug`-Feldnamen (`departMs`, `arriveMs`, `track`, `category`, `delayMin`, `fromName`, `toName`) in Task 4 definiert und in Task 5 identisch verwendet. ✓
