# Design: Live-Züge (Echtzeit) auf der Karte

**Datum:** 2026-07-08
**Status:** freigegeben (Brainstorming), bereit für Implementierungsplan

## Ziel

Fahrende Züge in Echtzeit als bewegte Marker auf der bestehenden Leaflet-Karte
anzeigen. Grundlage ist der MOTIS/Transitous-Endpunkt `map/trips`, der die im
aktuellen Kartenausschnitt fahrenden Verbindungen liefert. Die Position jedes
Zuges wird flüssig entlang seiner Polyline zwischen Ab- und Ankunft interpoliert.

**Nicht im Umfang:** Verbindungssuche (Bahnhof → Bahnhof, `plan`-Endpunkt).
Nur die Live-Zug-Anzeige.

## Datenquelle

- `GET https://api.transitous.org/api/v6/map/trips`
- **Direkter Browser-Fetch** – die API sendet `Access-Control-Allow-Origin: *`,
  daher kein Backend-Proxy nötig (anders als bei `streckeninfo`). Der Ausschnitt
  hängt ohnehin an der Live-Kartenansicht, das gehört auf den Client.
- Parameter:
  - `min` = `lat,lon` der Südwest-Ecke der aktuellen Ansicht (`map.getBounds().getSouthWest()`)
  - `max` = `lat,lon` der Nordost-Ecke (`getNorthEast()`)
  - `startTime` = jetzt (ISO UTC)
  - `endTime` = jetzt + Refetch-Intervall (damit gerade startende Züge dabei sind)
  - `zoom` = aktueller Kartenzoom
- Antwort: Array von Segmenten, je Segment ein fahrender Zug-Leg:

```jsonc
{
  "trips": [{ "tripId": "…", "displayName": "ICE 542" }],
  "mode": "HIGHSPEED_RAIL",
  "distance": 486755.5,               // Meter
  "from": { "name": "Wolfsburg…", "lat": 52.4295, "lon": 10.7878, … },
  "to":   { "name": "Hannover…",  "lat": 52.3768, "lon":  9.7410, … },
  "departure": "2026-07-08T18:29:00Z",          // echtzeit-korrigiert (UTC)
  "arrival":   "2026-07-08T19:00:00Z",
  "scheduledDeparture": "2026-07-08T17:53:00Z", // planmäßig (UTC)
  "scheduledArrival":   "2026-07-08T18:28:00Z",
  "realTime": true,
  "polyline": "kc__Is~y`A…"                      // Google-Polyline, Präzision 5
}
```

Verifizierte Fakten (aus API-Antesten am 2026-07-08):
- Polyline-**Präzision 5** (Standard-Google-Polyline) – Dekodierung trifft die
  `from`/`to`-Koordinaten exakt.
- Zeiten sind UTC-ISO → `Date.parse()` liefert Millisekunden direkt.
- Verspätung = `departure − scheduledDeparture` (bzw. `arrival − scheduledArrival`).

## Ansatz

**Direkter Client-Fetch + flüssige rAF-Animation** (gewählt).

Position pro Frame (`requestAnimationFrame`) entlang der Polyline aus
`frac = (jetzt − departure) / (arrival − departure)`, geklemmt auf [0, 1].
Marker bewegen sich weich, auch zwischen den Refetches.

Verworfene Alternativen:
- **Backend-Proxy** (wie `streckeninfo`): unnötig, da CORS offen und der
  Ausschnitt an die Live-Ansicht gebunden ist.
- **Statische Snapshot-Marker** ohne Animation: kein echtes Echtzeit-Gefühl.

## Verkehrsmittel-Filter

Nur Eisenbahn. `isRailMode` akzeptiert:
`HIGHSPEED_RAIL`, `LONG_DISTANCE`, `NIGHT_RAIL`, `REGIONAL_RAIL`,
`REGIONAL_FAST_RAIL`, `SUBURBAN` (S-Bahn).
Verworfen: `BUS`, `COACH`, `SUBWAY`, `TRAM`, `FERRY` und alles Übrige.

Kategorie-Farben (abgesetzt von den Infrastruktur-Overlays):
- Fernverkehr (`HIGHSPEED_RAIL`, `LONG_DISTANCE`, `NIGHT_RAIL`): rot
- Regionalverkehr (`REGIONAL_RAIL`, `REGIONAL_FAST_RAIL`): grün
- S-Bahn (`SUBURBAN`): blau

## Komponenten

Neue Datei **`public/live-trips.js`** (ES-Modul). Reine Logik ist von der
Leaflet/DOM-Glue getrennt (analog zur Trennung in `src/data/streckeninfo.ts`),
damit die reinen Funktionen im Node-Selbsttest ohne Browser prüfbar sind.

Reine Funktionen (exportiert, seiteneffektfrei):

1. **`decodePolyline(str, precision = 5) → [[lat, lon], …]`**
   Standard-Google-Polyline-Dekodierung.

2. **`buildTrack(coords) → { points, cumDist, total }`**
   Vorberechnung der kumulativen Distanzen (äquirektangulär genügt für kurze
   Segmente; nur für die Interpolationsparametrisierung, nicht für Anzeigelängen).

3. **`positionAt(track, frac) → [lat, lon]`**
   Position bei Anteil `frac` der Gesamtlänge (lineare Interpolation zwischen den
   beiden umgebenden Stützpunkten). Klemmt `frac` auf [0, 1].

4. **`isRailMode(mode) → boolean`** – Filter (siehe oben).

5. **`normalizeTrips(rawArray, nowMs) → Zug[]`**
   Roh-Segmente → `{ id, name, mode, category, track, departMs, arriveMs,
   delayMin, realTime, fromName, toName, schedDepartMs, schedArriveMs }`.
   Verwirft Nicht-Eisenbahn, Segmente ohne Polyline/gültige Zeiten und mit
   `arriveMs <= departMs`. `category` ∈ {fern, regio, sbahn} für die Farbwahl.

Glue (einziger Teil mit Seiteneffekten, exportiert):

6. **`initLiveTrips({ map, L, renderer, overlayControl })`**
   - Erzeugt eine `L.layerGroup()` und registriert sie als Overlay „Live-Züge"
     (standardmäßig **aus**).
   - Hält den aktuellen Zug-Bestand (`Map<id, {zug, marker}>`).
   - **Fetch**: baut die URL aus `map.getBounds()`/`map.getZoom()`, holt die
     Daten, `normalizeTrips`, gleicht den Bestand ab (neue Marker anlegen,
     verschwundene entfernen).
   - **rAF-Loop**: interpoliert je Frame die Position jedes Zuges und setzt
     `marker.setLatLng(...)`. Läuft nur bei eingeschaltetem Overlay.
   - **Refetch-Trigger**: Intervall (~30 s) und debounced `moveend`/`zoomend`
     (~400 ms).
   - **Zoom-Gate**: unter der Schwelle (≈ Zoom 9) kein Fetch; stattdessen dezenter
     Hinweis „Zum Anzeigen der Live-Züge näher heranzoomen".

`index.html`:
- Nach dem Erzeugen von `map`, `renderer`, `overlayControl` diese in ein kleines
  Shared-Objekt (`window.__ISR_MAP__`) legen.
- `<script type="module">` importiert `initLiveTrips` und ruft es mit den
  Shared-Objekten und dem globalen `L` auf.

## Datenfluss

```
Overlay „Live-Züge" AN
  └─ zoom ≥ Schwelle?
       ├─ nein → Hinweis, kein Fetch
       └─ ja   → fetch(map/trips, bbox, now)
                   → normalizeTrips → Bestand abgleichen (Marker add/remove)
rAF-Loop (dauerhaft bei AN):
  für jeden Zug: frac = (now − departMs)/(arriveMs − departMs)
                 marker.setLatLng(positionAt(track, frac))
moveend/zoomend (debounced) + Intervall(30 s) → erneuter Fetch
Overlay AUS / zoom < Schwelle → Loop pausiert, Layer geleert
```

## Darstellung / Popup

- Marker je Zug: kleiner Kreis-/Div-Icon-Marker in der Kategorie-Farbe, optional
  mit Kurzlabel (`displayName`).
- Popup-Felder: Linie (`displayName`), von → nach (`fromName` → `toName`),
  planmäßige und aktuelle Ab-/Ankunft, **Verspätung** (`delayMin`, farblich
  hervorgehoben ab +1 min), Echtzeit-Kennung (`realTime`).

## Fehlerbehandlung

- Fetch-Fehler (Netz/HTTP): dezente Statusmeldung „Live-Züge nicht verfügbar",
  Overlay bleibt umschaltbar, automatischer Retry beim nächsten Intervall.
  Der rAF-Loop wirft nie.
- Ungültige Segmente (keine Polyline, `arrival ≤ departure`, kaputte Zeiten)
  werden in `normalizeTrips` übersprungen.
- Overlay aus / Zoom zu klein → Loop pausiert sauber, keine Marker.

## Performance & Grenzen

- **Zoom-Schwelle** ≈ 9: verhindert die Riesen-Antwort bei kleinem Zoom
  (bundesweit mehrere MB). Fester Schwellwert als Konstante.
- Refetch: Intervall ~30 s + debounced (~400 ms) bei Karten-Interaktion.
- Canvas-Renderer nutzen (bereits vorhanden: `renderer`).
- Eisenbahn-Filter reduziert die Markerzahl deutlich (im Testausschnitt ~10 %
  der Segmente sind Bahn).

## Tests

**`src/web/live-trips.selftest.ts`** (in die CI-Selftests eingehängt, läuft mit
`tsx`, ohne Netz):
- `decodePolyline`: Dekodierung einer bekannten Polyline, Start/Ende treffen die
  erwarteten Koordinaten (Wolfsburg 52.4295,10.7878 → Hannover 52.3768,9.7410,
  Toleranz ~0.001°).
- `positionAt`: frac 0 → Start, frac 1 → Ende, frac 0.5 → mittig (bei
  gleichmäßigem Track), Klemmung außerhalb [0, 1].
- `isRailMode`: `HIGHSPEED_RAIL` → true, `BUS`/`SUBWAY`/`FERRY` → false.
- `normalizeTrips`: Bus-Segment verworfen, gültiges Bahn-Segment normalisiert,
  `delayMin` korrekt aus `departure − scheduledDeparture`, Segment mit
  `arrival ≤ departure` verworfen.

Import einer `.js` aus TypeScript erfordert `allowJs: true` in `tsconfig.json`
(bzw. für den Selbsttest). Wird im Plan berücksichtigt.

**End-to-End (Verifikation vor Abschluss):** App starten, Overlay „Live-Züge"
einschalten, in einen Ballungsraum zoomen (z. B. Hamburg/Hannover) und
beobachten, dass sich ICE/RE/S-Bahn-Marker weich bewegen und die Popups plausible
Daten (Linie, Verspätung) zeigen. Per Playwright oder manuell im Browser.

## Offene Punkte / bewusste Festlegungen

- Zoom-Schwelle, Refetch-Intervall und Debounce sind Konstanten und im
  Betrieb leicht justierbar; Startwerte: Zoom 9, 30 s, 400 ms.
- Kein Backend, keine neue Serverabhängigkeit; rein Frontend + ein Selbsttest.
