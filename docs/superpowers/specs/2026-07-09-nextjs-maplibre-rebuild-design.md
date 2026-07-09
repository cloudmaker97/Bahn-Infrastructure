# Design: Frontend-Rebuild auf Next.js + MapLibre GL, Server-geführte Datenflüsse

**Datum:** 2026-07-09
**Status:** per /goal beauftragt (Punkte 1–4), Entscheidungen dokumentiert

## Ziele (aus dem Auftrag)

1. Frontend in einem Frontend-Framework „wie Next.js" umbauen.
2. Karte von Leaflet auf **MapLibre GL** umstellen.
3. **Der Server ist federführend** für alle Antworten – keine direkten Browser-Anfragen
   an externe Daten-APIs. Live-Zugdaten u. Ä. mit **Burst-Cache (10 s)** wegen Rate-Limits.
4. Codestruktur: **DRY, SOLID, TypeScript, Node.js**.

## Entscheidungen (mit Begründung)

### Framework: Next.js 15, App Router, `output: 'export'` (statischer Export)
- Der bestehende Node-Server (Routing-Graph, TUI, SSE, Scraper – SOLID/TS) bleibt der
  **einzige** Server. Next liefert per statischem Export nur Build-Artefakte
  (`web/out/`), die der Node-Server ausliefert → genau ein Container (Coolify),
  „Server federführend" gilt uneingeschränkt.
- Verworfen: Next-Server parallel (zweiter Server, Proxy-Kaskade, Coolify-Mehraufwand)
  und Port des Backends in Next-API-Routes (sinnloser Big-Bang eines funktionierenden
  SOLID-Backends).
- Dev-Betrieb: `next dev` (Port 3000) mit `rewrites` → proxied `/api/*` und `/data/*`
  auf den Node-Server (Port via `API_PROXY`, Standard `http://localhost:8000`).
  Rewrites gelten nur im Dev; der Export ignoriert sie (Prod: gleiche Origin, kein Proxy nötig).

### Karte: MapLibre GL JS (npm-Paket, gebundelt = lokal, kein CDN)
- Basemap: **CARTO `dark_all`-Rasterkacheln** (keyless, echtes Dark-Design statt des
  bisherigen CSS-Invert-Hacks). Attribution: OSM-Mitwirkende + CARTO sowie die
  bestehenden Links (DB InfraGO, Transitous). Kacheln sind – wie bisher OSM – der
  einzige direkte externe Zugriff des Browsers; Daten-APIs laufen ausnahmslos über
  unseren Server. (Tile-Proxying würde unseren Server zur Tile-Farm machen – bewusst nicht.)
- Interaktion: Klick/Hover/Cursor über `queryRenderedFeatures` (löst die früheren
  Canvas-Hit-Test-Probleme nativ). Rechtsklick „Elemente in der Nähe":
  `queryRenderedFeatures` mit Pixel-Bbox (±14 px) über alle Info-Layer.
- Live-Züge: GeoJSON-Source + Circle-Layer; Animation über `source.setData(...)` im
  200-ms-Takt (wie bisher ~5 fps, sehr effizient in WebGL).

### Server federführend: neuer Endpunkt `GET /api/livetrips?zoom=N`
- **`LiveTripsService`** (neu, `src/data/live-trips-service.ts`):
  - Holt Transitous `map/trips` immer für die **Deutschland-Bbox** (aus
    `src/shared/de-boundary.json` abgeleitet) mit dem angefragten Zoom (ganzzahlig
    geklemmt auf [3..14] = Cache-Bucket).
  - Normalisiert serverseitig (reine Funktionen aus `src/shared/`): nur Eisenbahn-Modi,
    gültige Zeiten, dekodierbare Polyline, **aktuelle Position in Deutschland**
    (Point-in-Polygon, Zeitpunkt = Serverzeit).
  - Antwort: `{ generatedAt, trains: TrainDTO[], error: string|null }` mit
    `TrainDTO = { id, name, mode, category, polyline, departMs, arriveMs,
    schedDepartMs, schedArriveMs, delayMin, realTime, fromName, toName }`
    (Polyline bleibt kodiert → kleine Payload; Client dekodiert für die Animation).
  - **Cache: 10 s je Zoom-Bucket** (Burst-Schutz); wirft nie – Fehler landen im
    `error`-Feld, ggf. mit letztem Cache-Stand (Muster wie `StreckenInfoService`).
- `/api/streckeninfo` (Störungen/Baustellen/Ruhen/Sammelmeldungen) ist bereits
  server-gecacht (TTL 3 min) – unverändert.
- Der Client ruft **nur noch eigene Server-APIs** auf: `/api/livetrips`,
  `/api/streckeninfo(+events)`, `/api/route`, `/api/stations`, `/api/version`, `/data/*`.

### DRY/SOLID: gemeinsame reine Logik in `src/shared/`
- `polyline.ts` (decode), `geo.ts` (pointInRing/pointInBoundary/boundaryRings/ringsBbox,
  buildTrack/positionAt), `live-trips-core.ts` (isRailMode/categoryOf/CATEGORY_COLOR/
  normalizeTrips → TrainDTO), `de-boundary.json` – **eine Quelle**, portiert aus
  `public/live-trips.js` (das entfällt).
- Server: kompiliert `src/shared/` regulär mit (`rootDir: src`).
- Web: importiert dieselben Dateien via tsconfig-Alias `@shared/*` +
  `experimental.externalDir: true` (dokumentierter Fallback: Build-Sync-Skript).
- Frontend-Struktur (`web/src/`): `components/` (SidePanel, LayerControl, VersionBadge,
  Popup-Inhalte), `map/` (MapController-Klasse + Layer-Module: trains, streckeninfo,
  isr-overlays, nearby), `lib/` (api-Client, Typen). React für UI-Zustand; die Karte
  kapselt eine imperative `MapController`-Klasse (SRP; React-frei testbar).

## Funktionsparität (muss erhalten bleiben)

- Dark-Mode-UI, links fest angedockte Seitenleiste (ohne Header, nicht einklappbar).
- Einfärbung (Elektrifizierung/Vmax/Gleisanzahl/einfarbig) + Legende; Streckensuche
  mit Zoom + Hervorhebung; RL100-Routing mit Autocomplete, Ergebnis + Routen-Linie.
- Overlays mit Zählern: Übergangsstellen, Betriebsstellen (Popup inkl. zugehöriger
  Strecken via STEL-Index), Tunnel, Brücken, Bahnübergänge (alle default aus).
- Streckeninfo: Störungen (an), Baustellen/Streckenruhen (eingerückt, aus),
  Ruhen als gestrichelte Linien entlang der Strecke + Ankerpunkt, Sammelmeldungen-Box,
  SSE-Push + 3-min-Poll, Statuszeilen.
- Live-Züge: an, Unterfilter „Nur Echtzeit" (eingerückt, an), Kategorie-Farben
  (fern rot `#d23f3f`, regio grün `#2ec76b`, S-Bahn blau `#2f7fe0`), Tooltip (Name),
  Popup (von→nach, planmäßig/aktuell, Verspätung, Echtzeit), flüssige Bewegung,
  Zoom-Gate ≥ 3, Client-Poll ~15 s (Server-Cache 10 s), Pause bei Hintergrund-Tab.
- Rechtsklick: Liste überlappender Elemente (Typ + Farbe), Auswahl öffnet Popup.
- Versions-Badge unten rechts (`/api/version`), 🚆-Favicon, Titel „ISR – Streckennetz".
- Ladefortschritt für die große Strecken-GeoJSON (Streaming-Progress wie bisher).

## Build / Deploy / CI

- npm-Scripts (Root): `dev` (Server, wie bisher), `dev:web` (`next dev` in `web/`),
  `build:web` (`next build` → `web/out`), `build` (tsc + build:web).
- `StaticFileHandler`: statisches Root wird `web/out` (Fallback auf `public/` für
  `/data`-unabhängige Altpfade entfällt nach Cutover; `/data/*` bleibt `data/web`).
- Dockerfile: Build-Stage baut Backend (`tsc`) **und** Web (`next build`);
  Runtime kopiert `dist/` + `web/out/` (+ `package.json`). Compose/Coolify unverändert.
- CI: Typecheck Server + `tsc --noEmit` im Web, Selbsttests (streckeninfo, SSE, TUI,
  **live-trips-service**), `next build` als Smoke.
- Alt-Dateien `public/index.html`, `public/live-trips.js`, `public/live-trips.selftest.mjs`,
  `public/vendor/leaflet/` entfallen (Cutover); `public/de-boundary.geojson` wandert
  als JSON nach `src/shared/`.

## Tests

- `src/data/live-trips.selftest.ts`: reine Kerne (decode/track/position/rail/normalize/
  DE-Filter, Testvektoren aus dem bisherigen `.mjs`-Selbsttest) + Cache-Verhalten des
  Service (Fake-Fetch: 2 Aufrufe in <10 s → 1 Upstream-Call; Fehler → error-Feld).
- Web: `tsc --noEmit`; E2E per Playwright gegen den echten Server (Karte lädt, Züge
  bewegen sich, Popups/Nearby/Filter/Version, keine direkten transitous-Requests im
  Network-Log).

## Risiken / Grenzen

- `experimental.externalDir` ist als „experimental" markiert, aber etabliert;
  Fallback: Sync-Skript kopiert `src/shared` → `web/src/shared-gen` beim Build.
- CARTO-Basemap ist ein externer Kacheldienst (wie zuvor OSM); bei Ausfall bleibt
  die Karte funktional (Overlays/Züge unabhängig vom Basemap-Laden).
- Statischer Export: kein SSR/ISR – bewusst (reine Client-Karten-App, ein Server).
