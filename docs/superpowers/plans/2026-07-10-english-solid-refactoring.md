# English/SOLID Whole-Codebase Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the entire codebase (backend `src/` + frontend `web/src/`) to English-only identifiers and comments, DRY/SOLID structure, and better readability — with zero behavior change for users.

**Architecture:** The backend already follows DIP (interfaces in `src/types.ts`, composition root `src/main.ts`); the frontend already uses a controller/mediator class design. The refactor therefore focuses on: (1) translating German identifiers/comments to English, (2) eliminating duplication (shared API types, TTL-cache pattern, rounding, map-layer helpers, color scales), (3) splitting the one oversized module (`streckeninfo.ts`, 685 lines) by responsibility, and (4) decomposing the `MapApp.tsx` God-component.

**Tech Stack:** TypeScript strict (Node 22, tsx), Next.js 15 static export, MapLibre GL 5, no test framework (plain `assert` selftests run via `npx tsx`, mirrored in `.github/workflows/ci.yml`).

## Global Constraints

- **Zero behavior change.** All user-visible German text stays German: UI labels, popup captions, TUI output, server log lines, API error strings (e.g. `'Start nicht gefunden'`). Selftests assert on this text.
- **External wire formats untouched** (property names read from or sent to systems we do not control):
  - DB InfraGO WFS / raw GeoJSON: `ISR_*`, `BST_*`, `ALG_*`, `STEL_ID`, `BET_*`, `INF_*`, `LST_*`, `ENE_*`, `DET_*`, `STRECKEN_ABSCHNITT` …
  - strecken-info.de API: all property names inside the `Raw*` interfaces, the `FILTER` POST body keys, and the `WOCHENTAGE` weekday values (`MONTAG`…`SONNTAG`). Type *names* (`RawStoerung` → `RawDisruption`) are internal and get translated; *property names* inside stay.
  - Transitous `map/trips`: `RawSegment` fields, `RAIL_MODES` values.
- **Own API contract (backend ↔ web) IS renamed to English** — coordinated backend+frontend in the same commit (single deployment unit). Endpoint URLs and query params stay unchanged (`/api/streckeninfo`, `/api/streckeninfo/events`, `/api/livetrips?zoom=`, `/api/route?from&to&mode`, `/api/stations?q`, `/api/search?q`, `/api/version`, `/data/*`).
- **On-disk artifact names stay** (`geo_*.json`, `*_meta.json`, `*.csv`, `map_*.geojson`) — they are referenced by tracked raw data and web fetch URLs. Exception: `strecken_uebersicht.json` → `line-overview.json` with English keys; safe because `src/ensure-data.ts:24` rebuilds when the file is missing (self-healing on old installs).
- **`src/shared/` stays dependency-free** (must run in the browser via the `@shared/*` alias).
- **Verification after every task:** `npm run typecheck` + affected selftests (`npx tsx src/**/*.selftest.ts`) + `npm --prefix web run typecheck`; `npm --prefix web run build` at web-touching milestones. `.github/workflows/ci.yml` paths must be updated in the same commit as any selftest rename.
- **One commit per task**, conventional message, English.

## Domain Glossary (apply consistently everywhere)

| German | English |
|---|---|
| Strecke / Streckennummer | line / lineNumber |
| (Strecken-)Abschnitt | section |
| Verlauf / VerlaufResolver | alignment / AlignmentResolver |
| Teilstück / verketteTeilstuecke | segment / stitchSegments |
| Meldung / Betriebslage | notice / network status |
| Störung | disruption |
| Baustelle | construction site |
| Streckenruhe | line closure |
| Sammelmeldung | aggregate notice |
| Betriebsstelle | station (repo) / operating point (docs); SearchEntry kind: `'station'` |
| Bahnübergang / Brücke / Tunnel / Übergangsstelle | level crossing / bridge / tunnel / transition point |
| Gültigkeit / Zeitraum / Wochentag | validity / period / weekday |
| Wirkung / Verkehrsart | effect / transport mode |
| gleisEinschraenkung / verortet | trackRestriction / located |
| Luftlinie / Umweg / Stoß / nahbei | straight-line distance / detour / seam / isNear |
| berechne / runde / vereinfache / leereCache / hole… | compute / round / simplify / clearCache / fetch… |

---

### Task 1: Core geometry module (rename + shared rounding)

**Files:**
- Rename: `src/core/geo.ts` → `src/core/geometry.ts` (kills the `core/geo.ts` vs `shared/geo.ts` name collision)
- Rename: `src/core/geo.selftest.ts` → `src/core/geometry.selftest.ts`
- Modify: `src/data/graph-builder.ts`, `src/data/station-repository.ts`, `src/build-map-data.ts`, `src/routing/verlauf-resolver.ts`, `.github/workflows/ci.yml:29`

**Interfaces:**
- Produces: `stitchSegments(pieces: Coord[][]): Coord[]` (was `verketteTeilstuecke`), `parsePosition(s: string): Coord | null` (was `parseLage`), `round5(v: number): number` (NEW — replaces `build-map-data.ts` `r5` and `verlauf-resolver.ts` `runde`), `parseGermanNumber`, `haversine`, `polylineLengthKm` (unchanged signatures).

- [ ] Rename file, translate all identifiers (`STOSS_KM`→`SEAM_KM`, `DUPLIKAT_KM`→`DUPLICATE_KM`, `nahbei`→`isNear`, locals `roh/rest/kette/kopf/anEnde/umdrehen/teil`→`raw/remaining/chain/head/atEnd/reverse/piece`) and all comments to English.
- [ ] Add `round5` to `core/geometry.ts`; replace `r5` in `build-map-data.ts:23` and `runde` in `verlauf-resolver.ts:20` with imports.
- [ ] Update importers + selftest (translate its comments/locals too; keep numeric assertions identical) + CI path.
- [ ] Verify: `npm run typecheck` && `npx tsx src/core/geometry.selftest.ts` && `npx tsx src/routing/verlauf-resolver.selftest.ts`
- [ ] Commit: `refactor(core): rename geo to geometry, English identifiers, shared round5`

### Task 2: Shared isomorphic layer

**Files:**
- Modify: `src/shared/live-trips-core.ts`, `src/shared/geo.ts`, `src/shared/polyline.ts`, `src/shared/de-boundary.ts` (comments), `web/src/map/trains.ts` (only if it references category literals)

**Interfaces:**
- Produces: `TrainCategory = 'long-distance' | 'regional' | 'suburban' | 'other'` (was `'fern' | 'regio' | 'sbahn' | 'other'`); `CATEGORY_COLOR` re-keyed to match. `TrainDTO` field names unchanged (already English).

- [ ] Translate `TrainCategory` values + `categoryOf` + `CATEGORY_COLOR` keys; grep backend + web for `'fern'|'regio'|'sbahn'` literals and update all.
- [ ] Translate remaining German comments in all four shared files.
- [ ] Verify: `npm run typecheck` && `npx tsx src/data/live-trips.selftest.ts` && `npm --prefix web run typecheck`
- [ ] Commit: `refactor(shared): English train categories and comments`

### Task 3: Shared API contract types (kill web type duplication)

**Files:**
- Create: `src/shared/api-types.ts`
- Modify: `src/types.ts` (drop moved types, import from shared), `src/data/live-trips-service.ts` (move `LiveTripsResult`), `web/src/lib/types.ts` (reduce to re-exports or delete), all `web/src` importers of `@/lib/types`

**Interfaces:**
- Produces (in `@shared/api-types`): `LatLng`, `GeoFeature<P>`, `FeatureCollection<P>`, `RouteMode`, `RouteWaypoint`, `RouteSegment` (field `strecke` → `line`), `RouteResult`, `RouteError`, `RouteResponse`, `StationSuggestion` (unifies backend `Station` shape and web `StationSuggestion`), `VersionInfo`, `LiveTripsResult`. Network-status DTOs move here in Task 6.
- Note: `RouteSegment.strecke` is our own wire key → rename to `line` backend+web in this task (both sides in one commit; update `route-service.ts` producer and web `RoutingForm`/`route.ts` consumers).

- [ ] Create `src/shared/api-types.ts` with the moved types (English keys), delete duplicates from `src/types.ts` and `web/src/lib/types.ts`, update all importers (backend via relative import, web via `@shared/api-types`).
- [ ] Verify: `npm run typecheck` && `npm --prefix web run typecheck` && `npx tsx src/routing/verlauf-resolver.selftest.ts`
- [ ] Commit: `refactor(shared): single source for API contract types`

### Task 4: Data layer — sections domain + repositories

**Files:**
- Rename: `src/data/abschnitt-repository.ts` → `src/data/section-repository.ts`
- Modify: `src/types.ts` (`AbschnittProps`→`SectionProps`, `AbschnittLookup`→`SectionLookup` with methods `byStrecke`→`byLineNumber`, `byStation` kept), `src/data/isr-data.ts` (`abschnitte`→`sections`), `src/data/reloadable-isr-data.ts`, `src/data/graph-builder.ts`, `src/data/station-repository.ts`, `src/data/search-index.ts`, `src/data/json-store.ts`, `src/tui/tui-renderer.ts` + `src/tui/tui.selftest.ts` (consume `SectionLookup`), `src/server/api-router.ts`, `src/main.ts`

**Interfaces:**
- Produces: `class SectionRepository implements SectionLookup`; `SectionLookup { byLineNumber(nr): SectionProps[]; byStation(stelId): SectionProps[] }`; `IsrData.sections`.

- [ ] Rename types/class/file, translate internals (`teile`→`pieces`, `lage`→`position` …) and comments in all seven data files; keep every wire property access unchanged.
- [ ] Verify: `npm run typecheck` && `npx tsx src/tui/tui.selftest.ts` && `npx tsx src/data/streckeninfo.selftest.ts`
- [ ] Commit: `refactor(data): sections domain in English`

### Task 5: Routing — AlignmentResolver

**Files:**
- Rename: `src/routing/verlauf-resolver.ts` → `src/routing/alignment-resolver.ts`, `src/routing/verlauf-resolver.selftest.ts` → `src/routing/alignment-resolver.selftest.ts`
- Modify: `src/types.ts` (`VerlaufLookup`→`AlignmentLookup`, method `resolveVerlauf`→`resolveAlignment`), `src/data/streckeninfo.ts`, `src/main.ts`, `.github/workflows/ci.yml:43-44`, `src/routing/route-service.ts` (comments only; German error strings stay)

**Interfaces:**
- Produces: `class AlignmentResolver implements AlignmentLookup` — `resolveAlignment(fromRil100, toRil100, lineNumbers): LatLng[] | null`, `clearCache()` (was `leereCache`), exported `simplifyPath` (was `vereinfache`), constants `DETOUR_FACTOR`, `DETOUR_BONUS_KM`, `SIMPLIFY_TOLERANCE_M`, `METERS_PER_DEGREE`, private static `chainEdgeGeometries` (was `kette`).

- [ ] Rename files/class/interface/methods, translate locals (`von/bis/strecken/vorwaerts/pfad/luftKm/naechste`→`from/to/lines/forward/path/straightKm/nearest`) and comments; update selftest + CI.
- [ ] Verify: `npm run typecheck` && `npx tsx src/routing/alignment-resolver.selftest.ts` && `npx tsx src/data/streckeninfo.selftest.ts`
- [ ] Commit: `refactor(routing): AlignmentResolver in English`

### Task 6: Split streckeninfo.ts by responsibility (no key changes yet)

**Files:**
- Create: `src/data/network-status/wire.ts` (Raw* interfaces — English type names, wire property names untouched; the `FILTER` request body; `WOCHENTAGE`), `src/data/network-status/transform.ts` (all pure functions), `src/data/network-status/service.ts` (`NetworkStatusService`, was `StreckenInfoService`)
- Delete: `src/data/streckeninfo.ts`
- Rename: `src/data/streckeninfo.selftest.ts` → `src/data/network-status/network-status.selftest.ts`
- Modify: `src/main.ts`, `src/server/api-router.ts`, `.github/workflows/ci.yml:31-32`

**Interfaces:**
- Produces: `NetworkStatusService.get(): Promise<StreckenInfoResult>` (result type still German-keyed in this task), `invalidate()`; pure exports `mercatorToWgs84`, `isCurrentlyActive` (was `istAktuellAktiv`), `buildGeoJson` (was `baueGeoJson`), `toDisruptionFeature`, `toConstructionFeature`, `toClosureFeature`, `toDisruptionNoticeDto`, `toAggregateNoticeDto`, `CoordResolver`, `RawNetworkStatus` (was `StreckenInfoRohdaten`).
- DTO/GeoJSON **output keys stay byte-identical** in this task — the selftest passes with only import/name updates.

- [ ] Split the file (wire / transform / service), translate all internal identifiers and comments, keep output shape identical; update importers, selftest imports/names, CI paths.
- [ ] Verify: `npm run typecheck` && `npx tsx src/data/network-status/network-status.selftest.ts`
- [ ] Commit: `refactor(data): split network-status into wire/transform/service`

### Task 7: English API keys for network status (coordinated backend + web)

**Files:**
- Modify: `src/shared/api-types.ts` (add DTOs), `src/types.ts` (drop German DTOs), `src/data/network-status/transform.ts` + `service.ts`, `src/data/network-status/network-status.selftest.ts` (assert new keys), `web/src/lib/types.ts`, `web/src/lib/api.ts` (`getStreckenInfo`→`getNetworkStatus`; URL unchanged), `web/src/map/streckeninfo.ts` → `web/src/map/network-status.ts`, `web/src/components/Sammelmeldungen.tsx` → `web/src/components/AggregateNotices.tsx`, `web/src/components/MapApp.tsx`, `web/src/components/SidePanel.tsx`

**Interfaces:**
- Produces (in `@shared/api-types`):
  ```ts
  export type NetworkStatusCategory = 'disruption' | 'construction' | 'closure';
  export interface ValidityDTO { startDate?: string; endDate?: string; weekdays?: string[]; startTime?: string; endTime?: string }
  export interface AggregateNoticeDTO { key: string; cause?: string; subcause?: string; text?: string; start?: string; end?: string; transportModes?: string[] }
  export interface DisruptionNoticeDTO { /* was StoerungMeldungDTO: beginn→start, ende→end, verkehrsarten→transportModes, gleisEinschraenkung→trackRestriction, verortet→located */ }
  export interface NetworkStatusResult {
    disruptions: FeatureCollection; constructionSites: FeatureCollection; lineClosures: FeatureCollection;
    aggregateNotices: AggregateNoticeDTO[]; disruptionNotices: DisruptionNoticeDTO[];
    counts: { disruptions: number; unlocatedDisruptions: number; constructionSites: number; lineClosures: number; aggregateNotices: number };
    /* keep remaining fields (generatedAt/error/…) exactly as currently shaped, English-keyed */
  }
  ```
  GeoJSON feature properties renamed: `kategorie`→`category` (values `disruption|construction|closure`), `wirkungen`→`effects`, `wirkung`→`effect`, `verkehrsarten`→`transportModes`, `beginn`→`start`, `ende`→`end`, `gleisEinschraenkung`→`trackRestriction`, `langnameVon/Bis`→`longNameFrom/To`, `ril100Von/Bis`→`ril100From/To`, `streckennummern`→`lineNumbers`, `streckennummer`→`lineNumber`, `arbeiten`→`works`, `richtung`→`direction`, `gueltigkeiten`→`validities` (as `ValidityDTO[]`, weekday *values* stay `MONTAG`… for display), `bstLangname`→`stationLongName`, `region` stays, client-internal `ankerKlein`→`anchorSmall`.
- Consumes: Task 6 module split; Task 3 `@shared/api-types`.

- [ ] Rename backend output keys in transform/service, mirror in web popups/panel/notices component, move DTOs to `@shared/api-types`, update selftest assertions, rename web files (`SiKategorie`→`NetworkStatusCategory`, `SI_COLOR`→`STATUS_COLOR`, `SiPanelDaten`→`NetworkStatusPanelData`, `gueltigkeitKurz`→`formatValidityShort`, `stoerungPopupHtml`→`disruptionPopupHtml`, `baustellePopupHtml`→`constructionPopupHtml`, `ruhePopupHtml`→`closurePopupHtml`, class `StreckenInfoLayers`→`NetworkStatusLayers`, `rebuildRuhen`→`rebuildClosures`).
- [ ] Verify: `npm run typecheck` && `npx tsx src/data/network-status/network-status.selftest.ts` && `npm --prefix web run typecheck` && `npm --prefix web run build`
- [ ] Commit: `refactor(api)!: English keys for network-status contract (backend+web)`

### Task 8: Extract TTL cache + single-flight (DRY the two services)

**Files:**
- Create: `src/core/ttl-cache.ts`, `src/core/ttl-cache.selftest.ts`
- Modify: `src/data/live-trips-service.ts`, `src/data/network-status/service.ts`, `.github/workflows/ci.yml` (add selftest step)

**Interfaces:**
- Produces:
  ```ts
  export class TtlCache<K, V> {
    constructor(private readonly ttlMs: number) {}
    get(key: K): V | undefined;           // undefined when missing or expired
    getStale(key: K): V | undefined;      // ignores TTL (last-known-good fallback)
    set(key: K, value: V): void;
    clear(): void;
  }
  export class SingleFlight<K, V> { run(key: K, fn: () => Promise<V>): Promise<V> }
  ```
- Consumes: nothing new; both services keep their public APIs and selftests.

- [ ] TDD: write `ttl-cache.selftest.ts` (fresh hit, expiry via injected clock or short ttl + await, `getStale`, single-flight dedupes concurrent calls), watch it fail, implement, watch it pass.
- [ ] Refactor `LiveTripsService` (per-bucket cache + inflight map) and `NetworkStatusService` (single-key cache, error-in-field + stale fallback) onto the utilities; translate remaining German internals (`ZEITFENSTER_MS`→`TIME_WINDOW_MS`, `holeUndCache`→`fetchAndCache`, `holeRevision(Einmal)`→`fetchRevision(Once)`, `fertig`→`settle`).
- [ ] Verify: `npm run typecheck` && `npx tsx src/core/ttl-cache.selftest.ts` && `npx tsx src/data/live-trips.selftest.ts` && `npx tsx src/data/network-status/network-status.selftest.ts`
- [ ] Commit: `refactor(core): shared TtlCache and SingleFlight`

### Task 9: Server layer + composition root

**Files:**
- Modify: `src/server/api-router.ts` (ctor takes one `ApiRouterDeps` options object instead of 7 positional params; field `streckeninfo`→`networkStatus`), `src/server/http-server.ts`, `src/server/sse-hub.ts`, `src/server/static-file-handler.ts`, `src/server/sse-hub.selftest.ts`, `src/main.ts` (English comments; log strings stay German; `leereCache`→`clearCache` call already updated in Task 5)

**Interfaces:**
- Produces: `interface ApiRouterDeps { routes: RouteService; stations: StationSuggester; search: EntitySearch; networkStatus: NetworkStatusService; liveTrips: LiveTripsService; sse: SseHub; version: string }` (align exact member list with current ctor params when editing).

- [ ] Convert ctor, translate comments across server files + selftest + main.ts.
- [ ] Verify: `npm run typecheck` && `npx tsx src/server/sse-hub.selftest.ts`
- [ ] Commit: `refactor(server): options-object wiring, English comments`

### Task 10: TUI — English identifiers, German display labels

**Files:**
- Modify: `src/types.ts` (`SearchEntry.kind: 'station' | 'line' | 'tunnel' | 'bridge' | 'level-crossing' | 'transition-point'` — match the exact current German value set; `MeldungenProvider`→`NoticesProvider`), `src/data/search-index.ts` (produce English kinds), `src/tui/ansi.ts` (`KIND_COLOR` keys English; NEW `KIND_LABEL: Record<Kind, string>` with the German display labels), `src/tui/tui-renderer.ts` (render `KIND_LABEL[kind]`; `renderMeldungen`→`renderNotices`, `meldungBlock`→`noticeBlock`, `streckenBody`→`lineBody`, `betriebsstelleBody`→`stationBody`, `abschnittRow`→`sectionRow`, `MeldungenView`→`NoticesView`, `FILTER_CYCLE` values English), `src/tui/tui-app.ts` (`meldungen*`→`notices*`), `src/tui/input-handler.ts` (`TuiAction` values `'meldungen-open'`→`'notices-open'` etc.), `src/tui/tui.selftest.ts` (identifiers English; assertions on rendered German text unchanged)

**Interfaces:**
- Produces: `KIND_LABEL` maps kind → German label (`station`→`'Betriebsstelle'`, `line`→`'Strecke'`, `tunnel`→`'Tunnel'`, `bridge`→`'Brücke'`, `level-crossing`→`'Bahnübergang'`); `/api/search` now returns English `kind` values (no known external consumer; web does not call it — verified).

- [ ] Apply renames, add label map, keep all rendered German text identical (selftest is the guard).
- [ ] Verify: `npm run typecheck` && `npx tsx src/tui/tui.selftest.ts`
- [ ] Commit: `refactor(tui): English identifiers, German labels via KIND_LABEL`

### Task 11: Top-level scripts + line overview artifact

**Files:**
- Modify: `src/build-map-data.ts` (`buildStreckenUebersicht`→`buildLineOverview`; write `data/raw/line-overview.json` with keys `lineNumber` (was `ISR_STRE_NR`), `sectionCount` (was `anz_abschnitte`), `operators` (was `betreiber`), `countries` (was `staat`), `alignment` (was `verlauf`) — match exact current value shapes), `src/ensure-data.ts` (marker `UEBERSICHT`→`LINE_OVERVIEW` path `line-overview.json`), `src/data/search-index.ts` + `src/tui/tui-renderer.ts` (read new keys), `src/scrape.ts`, `src/config.ts`, `src/app-version.ts`, `src/types.ts` (final German sweep)

**Interfaces:**
- Produces: `data/raw/line-overview.json` (regenerated automatically on old installs because `ensureData` sees it missing). Old `strecken_uebersicht.json` files remain on disk but unused — note this in the PR description.

- [ ] Rename function/file/keys + readers, translate remaining comments in the five scripts.
- [ ] Verify: `npm run typecheck` && `npx tsx src/tui/tui.selftest.ts` (covers overview rendering via stubs)
- [ ] Commit: `refactor(build): English line-overview artifact and script comments`

### Task 12: Web map layer — shared helpers + English modules

**Files:**
- Create: `web/src/map/common.ts` (`TRAINS_LAYER_ID = 'trains'`, `emptyFeatureCollection()`, `class HoverTooltip`, `circleLayerSpec(...)`/`lineLayerSpec(...)` factories — extracted from the four copies), `web/src/map/color-scales.ts` (single source: speed/traction/track-count thresholds + colors + German legend labels; derives the MapLibre `COLOR_EXPR`, `colorForProps`, and SidePanel `LEGENDS`)
- Rename: `web/src/map/strecken.ts` → `web/src/map/rail-network.ts` (class `StreckenLayer`→`RailNetworkLayer`, `GRAU`→`NEUTRAL_GREY`, `StelAbschnitt`→`StationSection`, `abschnitteByStel`→`sectionsByStation`, `featuresByNr`→`featuresByLineNumber`, `streckenPopupHtml`→`linePopupHtml`)
- Modify: `web/src/map/isr-overlays.ts` (`OVERLAY_EINTRAEGE`→`OVERLAY_ENTRIES`, `OverlayKey` values English (`transition-points`, `stations`, `tunnels`, `bridges`, `level-crossings`) — `file:` fields keep the German geojson names; `art`→`geomType` (`'point' | 'line'`), `farbe`→`color`, `bstPopupHtml`→`stationPopupHtml`), `web/src/map/trains.ts` (`fehler`→`error`, `zeit`→`time`, use `HoverTooltip` + `TRAINS_LAYER_ID`), `web/src/map/route.ts` (`leer`→gone, use `common.ts`; internal feature props `farbe`/`beschriftung`→`color`/`label`), `web/src/map/network-status.ts` (use `common.ts` helpers), `web/src/map/nearby.ts` (`buildListe`→`buildList`), `web/src/map/controller.ts` (English comments; attribution HTML unchanged), `web/src/components/MapApp.tsx` + `SidePanel.tsx` (import updates)

**Interfaces:**
- Produces: `common.ts` and `color-scales.ts` as the single sources; all five layer modules consume them. German UI strings (labels, popup captions) stay inline and unchanged.

- [ ] Extract helpers, apply renames, delete the duplicated `leer()`/tooltip/layer-spec/legend copies.
- [ ] Verify: `npm --prefix web run typecheck` && `npm --prefix web run build`
- [ ] Commit: `refactor(web/map): shared helpers, single color scale, English modules`

### Task 13: Web components — decompose MapApp, English identifiers

**Files:**
- Create: `web/src/components/use-map-layers.ts` (hook owning controller+layer construction/disposal and exposing typed handles; extracted from `MapApp.tsx:47-86`)
- Modify: `web/src/components/MapApp.tsx` (use hook; replace the `'si-'`/`'ov-'` string-key protocol with typed toggle entries `{ id, label, visible, apply(v: boolean): void }`), `web/src/components/RoutingForm.tsx` (`von/nach/modus/vorschlaege/ergebnis/fehler/laeuft`→`from/to/mode/suggestions/result/error/loading`, `zeitText`→`formatDuration`, `loeschen`→`clearRoute`, `berechnen`→`calculateRoute`; fix stale hint `'Läuft der Server (node isr-server.js)?'`→`'Läuft der Server (npm start)?'`), `web/src/components/SearchForm.tsx` (`suchen`→`search`), `web/src/components/SidePanel.tsx` (legend from `color-scales.ts`), `web/src/components/VersionBadge.tsx` (`aktiv`→`active`), `web/src/lib/format.ts` (`fmtZeitraum`→`formatDateRange`, params `beginn/ende`→`start/end`, `titel`→`title`), `web/src/lib/api.ts` (comments), `web/src/app/layout.tsx` + `page.tsx` (comments), `web/next.config.mjs` (`istProd`→`isProd`, `ziel`→`target`, comments)

**Interfaces:**
- Consumes: Task 12 modules. All German UI strings unchanged (except the factually stale server hint above).

- [ ] Extract hook, convert toggles, apply renames, translate comments.
- [ ] Verify: `npm --prefix web run typecheck` && `npm --prefix web run build`
- [ ] Commit: `refactor(web): decompose MapApp, English component internals`

### Task 14: Housekeeping + full verification

**Files:**
- Modify: `.github/workflows/ci.yml` (English step names/comments; confirm all selftest paths), `Dockerfile`, `docker-compose.yml`, `.dockerignore` (English comments), `package.json` (English `description`), `web/src/app/globals.css` (comments, if German), final `grep` sweep for leftover German identifiers/comments (excluding UI strings, wire formats, README, docs/)

- [ ] Housekeeping edits; sweep with `rg -n "(?i)(ae|oe|ue|ß)" src web/src --type ts` plus manual review to catch stragglers (careful: German UI strings are expected hits).
- [ ] Full verification: `npm run typecheck` && all 7 selftests && `npm run build` (tsc emit) && `npm --prefix web run typecheck` && `npm --prefix web run build`.
- [ ] Runtime smoke (data copied from the main checkout into the worktree): start server headless on a free port, curl `/api/version`, `/api/stations?q=AH`, `/api/route?from=AH&to=MH&mode=time`, `/api/streckeninfo`, `/data/map_streckenabschnitte.geojson`, then stop. Confirm JSON shapes match the new English contract.
- [ ] Commit: `chore: English CI/docker/package metadata`

---

## Self-Review Notes

- **Spec coverage:** English-only identifiers/comments → Tasks 1–14 (per-file sweeps + final grep). DRY → Tasks 1 (round5), 3 (API types), 8 (TtlCache), 12 (map helpers, color scale). SOLID → Tasks 6 (SRP split), 9 (deps object), 13 (MapApp decomposition); existing DIP preserved. Classes/types → already class-based; new code follows. Readability → renames, file splits, glossary consistency.
- **Deliberately out of scope (documented):** German README/docs (user-facing), UI/log/error strings (product language), endpoint URLs, on-disk artifact names except `line-overview.json`, `docs/superpowers/` history, message-catalog extraction (YAGNI), test-framework migration (selftest pattern kept).
- **Type consistency check:** `SectionLookup.byLineNumber/byStation` (T4) used by TUI renderer (T10); `resolveAlignment` (T5) consumed by network-status transform (T6/7); `NetworkStatusResult` (T7) consumed by web api.ts/panel; `TtlCache.getStale` used by NetworkStatusService error fallback (T8).
