# TUI-Störungsmeldungen + Live-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Störungen + Sammelmeldungen von strecken-info.de in der TUI anzeigen, mit Taste `r` frisch scrapen und Karte via SSE-Push aktualisieren.

**Architecture:** Eine geteilte `StreckenInfoService`-Instanz versorgt Web (`ApiRouter`) und TUI (`TuiApp`) — Single Source of Truth. Die TUI hängt am schmalen Port `MeldungenProvider`. Ein `SseHub` pusht Refresh-Events an den Browser; der Datenservice bleibt via `onRefresh`-Callback von HTTP/SSE entkoppelt.

**Tech Stack:** TypeScript (ESM, `type: module`), Node.js `node:http`, `tsx` zum Ausführen, `node:assert` für Selftests. Kein Test-Runner — Tests sind eigenständige `*.selftest.ts`-Dateien, ausgeführt mit `npx tsx <datei>`.

## Global Constraints

- ESM mit `.js`-Endung in Imports (z. B. `import … from '../types.js'`), auch für `.ts`-Quellen.
- Kommentare/UI-Texte auf Deutsch; im Quellcode werden Umlaute in Kommentaren wie bestehend teils als `ae/oe/ue` geschrieben — bestehenden Stil der jeweiligen Datei fortführen.
- SOLID: eine Verantwortung je Unit; reine Render-/Parse-Funktionen bleiben seiteneffektfrei; Datenservice kennt kein HTTP/SSE.
- `getData()` wirft nie — Fehler stehen im `error`-Feld.
- Kein neues npm-Paket; nur vorhandene Abhängigkeiten.
- Typecheck-Gate: `npm run typecheck` (= `tsc --noEmit`) muss nach jeder Task fehlerfrei sein.

---

### Task 1: Datenvertrag nach `types.ts` verlagern + Port `MeldungenProvider`

Mechanischer Refactor, damit der Port auf `StreckenInfoResult` zeigen kann, ohne die Import-Richtung umzukehren (`streckeninfo.ts` importiert aus `types.ts`, nicht umgekehrt).

**Files:**
- Modify: `src/types.ts` (Vertrags-Interfaces + Port ergänzen)
- Modify: `src/data/streckeninfo.ts` (Interfaces entfernen, aus `types.js` importieren/re-exportieren)

**Interfaces:**
- Produces (in `src/types.ts`):
  - `interface StoerungMeldungDTO { key: string; cause: string; subcause: string; text: string; beginn: string; ende: string; verkehrsarten: string[]; gleisEinschraenkung: string; verortet: boolean }`
  - `interface SammelmeldungDTO { key: string; cause: string; subcause: string; text: string; beginn: string; ende: string; verkehrsarten: string[] }`
  - `interface StreckenInfoResult { stoerungen: FeatureCollection; baustellen: FeatureCollection; streckenruhen: FeatureCollection; sammelmeldungen: SammelmeldungDTO[]; stoerungenListe: StoerungMeldungDTO[]; generatedAt: string; counts: { stoerungen: number; stoerungenOhneOrt: number; baustellen: number; streckenruhen: number; sammelmeldungen: number }; error: string | null }`
  - `interface MeldungenProvider { getData(opts?: { force?: boolean }): Promise<StreckenInfoResult> }`

- [ ] **Step 1: Vertrags-Interfaces in `src/types.ts` ergänzen**

Am Ende von `src/types.ts` anfügen (nutzt das bereits vorhandene `FeatureCollection`):

```ts
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
```

- [ ] **Step 2: In `src/data/streckeninfo.ts` die verschobenen Interfaces löschen und importieren**

Die lokalen Definitionen von `StreckenInfoResult` und `SammelmeldungDTO` (aktuell Zeilen ~13–37) entfernen. Den bestehenden Typ-Import oben erweitern:

```ts
import type {
  FeatureCollection,
  GeoFeature,
  StationLookup,
  StreckenInfoResult,
  SammelmeldungDTO,
  StoerungMeldungDTO,
} from '../types.js';
```

Zur Abwärtskompatibilität bestehender Importe die Typen re-exportieren (direkt unter dem Import):

```ts
export type { StreckenInfoResult, SammelmeldungDTO, StoerungMeldungDTO } from '../types.js';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler (nur Verlagerung; `stoerungenListe` wird in Task 2 befüllt — bis dahin würde `baueGeoJson` einen Fehler werfen, weil das Feld fehlt).

> Hinweis: Falls `tsc` hier bereits `stoerungenListe` in `baueGeoJson` anmahnt, ist das erwartet — Task 2 folgt unmittelbar. Diese eine Task NICHT einzeln committen; zusammen mit Task 2 committen (gemeinsamer grüner Zustand). Bis dahin weiter mit Task 2.

---

### Task 2: `stoerungenListe` + `toStoerungMeldungDTO` in `baueGeoJson`

**Files:**
- Modify: `src/data/streckeninfo.ts`
- Test: `src/data/streckeninfo.selftest.ts`

**Interfaces:**
- Consumes: `StoerungMeldungDTO`, `StreckenInfoResult` (Task 1), vorhandene `RawStoerung`, `CoordResolver`, `verkehrsartenFlach`, `istAktuellAktiv`.
- Produces:
  - `export function toStoerungMeldungDTO(s: RawStoerung, verortet: boolean): StoerungMeldungDTO`
  - `baueGeoJson(...)`-Ergebnis enthält zusätzlich `stoerungenListe: StoerungMeldungDTO[]`.

- [ ] **Step 1: Failing test in `src/data/streckeninfo.selftest.ts` ergänzen**

Vor dem LIVE-Smoke-Block einfügen (nutzt `baueGeoJson`, das bereits importiert ist):

```ts
// --- stoerungenListe: verortete + nicht verortete Stoerungen ---
{
  const now = new Date(2026, 6, 6, 12, 0, 0); // Montag 12:00, aktiv
  const zeitraum = { beginn: '2026-07-01T00:00:00', ende: '2026-12-31T23:59:59' };
  const resolve: CoordResolver = (r) => (r === 'AA' ? [9.9, 48.4] : null);
  const roh: StreckenInfoRohdaten = {
    stoerungen: [
      { key: 'v', cause: 'Signalstoerung', subcause: 'x', text: 'verortet',
        zeitraum, betriebsstellen: [{ ril100: 'AA' }],
        wirkungenMitVerkehrsarten: [{ wirkung: 'Sperrung', verkehrsarten: ['FV', 'NV'] }] },
      { key: 'o', cause: 'Oberleitung', subcause: 'y', text: 'ohne Ort',
        zeitraum, gleisEinschraenkung: 'SCHWER' }, // keine Geo-Quelle -> nicht verortbar
    ],
    baustellen: [],
    streckenruhen: [],
    sammelmeldungen: [],
  };

  const r = baueGeoJson(roh, now, resolve);

  assert.strictEqual(r.stoerungen.features.length, 1, 'nur verortete in features');
  assert.strictEqual(r.stoerungenListe.length, 2, 'alle aktiven in stoerungenListe');
  const verortet = r.stoerungenListe.find((m) => m.key === 'v');
  const ohneOrt = r.stoerungenListe.find((m) => m.key === 'o');
  assert.ok(verortet && verortet.verortet === true, 'v ist verortet');
  assert.deepStrictEqual(verortet!.verkehrsarten.sort(), ['FV', 'NV'], 'verkehrsarten flach');
  assert.ok(ohneOrt && ohneOrt.verortet === false, 'o ist nicht verortet');
  assert.strictEqual(ohneOrt!.gleisEinschraenkung, 'SCHWER', 'gleisEinschraenkung uebernommen');
  assert.strictEqual(r.counts.stoerungenOhneOrt, 1, 'ohne-Ort-Zaehler unveraendert');
}
```

Sicherstellen, dass `StreckenInfoRohdaten` im Import-Block der Selftest-Datei enthalten ist (ist es bereits).

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `npx tsx src/data/streckeninfo.selftest.ts`
Expected: FAIL — `r.stoerungenListe` ist `undefined` bzw. Compile-Fehler „Property 'stoerungenListe' is missing".

- [ ] **Step 3: `toStoerungMeldungDTO` implementieren**

In `src/data/streckeninfo.ts` direkt vor `toSammelmeldungDTO` einfügen:

```ts
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
```

- [ ] **Step 4: `baueGeoJson` erweitern**

Im Body von `baueGeoJson`, nachdem `stoerungenAlle`, `stoerungenFeat` und `stoerungenOhneOrt` berechnet sind, die Liste bauen. `stoerungenAlle` sind `GeoFeature`s; für das DTO wird die zugehörige Roh-Störung benötigt. Daher `stoerungenAlle`-Berechnung so umstellen, dass die Roh-Störung erhalten bleibt:

Ersetze den Block

```ts
  const stoerungenAlle = rohStoerungen
    .filter((s) => s.sammelmeldung !== true && istAktuellAktiv(s, now))
    .map((s) => toStoerungFeature(s, resolveCoord));
  const stoerungenFeat = stoerungenAlle.filter((f) => f.geometry !== null);
  const stoerungenOhneOrt = stoerungenAlle.length - stoerungenFeat.length;
```

durch

```ts
  const stoerungenAktiv = rohStoerungen.filter(
    (s) => s.sammelmeldung !== true && istAktuellAktiv(s, now),
  );
  const stoerungenAlle = stoerungenAktiv.map((s) => toStoerungFeature(s, resolveCoord));
  const stoerungenFeat = stoerungenAlle.filter((f) => f.geometry !== null);
  const stoerungenOhneOrt = stoerungenAlle.length - stoerungenFeat.length;
  // Text-Liste ALLER aktiven Stoerungen (verortet-Flag aus der gebauten Geometrie).
  const stoerungenListe = stoerungenAktiv.map((s, i) =>
    toStoerungMeldungDTO(s, stoerungenAlle[i]!.geometry !== null),
  );
```

Im `return`-Objekt `stoerungenListe` ergänzen (nach `sammelmeldungen`):

```ts
    sammelmeldungen,
    stoerungenListe,
```

- [ ] **Step 5: `StreckenInfoService.empty` erweitern**

In der statischen Methode `empty(...)` das Feld ergänzen (nach `sammelmeldungen: []`):

```ts
      sammelmeldungen: [],
      stoerungenListe: [],
```

- [ ] **Step 6: Test ausführen (muss bestehen)**

Run: `npx tsx src/data/streckeninfo.selftest.ts`
Expected: PASS (alle asserts, inkl. bestehender).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 8: Commit (Task 1 + 2 gemeinsam)**

```bash
git add src/types.ts src/data/streckeninfo.ts src/data/streckeninfo.selftest.ts
git commit -m "feat(streckeninfo): stoerungenListe + Datenvertrag nach types.ts"
```

---

### Task 3: Force-Refresh + `onRefresh`-Callback im Service

**Files:**
- Modify: `src/data/streckeninfo.ts`
- Test: `src/data/streckeninfo.selftest.ts` (LIVE-Smoke-Log erweitern)

**Interfaces:**
- Produces:
  - Konstruktor-Option `onRefresh?: () => void`.
  - `getData(opts?: { force?: boolean }): Promise<StreckenInfoResult>` (erfüllt `MeldungenProvider`).
  - `onRefresh` wird **nur nach echtem Netz-Scrape** aufgerufen, nicht bei Cache-Treffern.

- [ ] **Step 1: Konstruktor-Feld ergänzen**

In `class StreckenInfoService` das Feld und die Option ergänzen. Bestehenden Konstruktor anpassen:

```ts
  private readonly ttlMs: number;
  private readonly onRefresh: (() => void) | null;
  private cache: { data: StreckenInfoResult; ts: number } | null = null;

  constructor(
    private stations: StationLookup,
    opts?: { apiBase?: string; wsUrl?: string; ttlMs?: number; onRefresh?: () => void },
  ) {
    this.apiBase = opts?.apiBase ?? 'https://strecken-info.de/api';
    this.wsUrl = opts?.wsUrl ?? 'wss://strecken-info.de/api/websocket';
    this.ttlMs = opts?.ttlMs ?? 180_000;
    this.onRefresh = opts?.onRefresh ?? null;
  }
```

- [ ] **Step 2: `getData` mit `force` + Callback**

`getData()`-Signatur und Cache-Logik anpassen:

```ts
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
      );
      const data: StreckenInfoResult = { ...gebaut, generatedAt: now.toISOString(), error: null };
      this.cache = { data, ts: nowMs };
      if (this.onRefresh) this.onRefresh(); // nur nach echtem Scrape
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.cache) return { ...this.cache.data, error: msg };
      return StreckenInfoService.empty(msg, new Date().toISOString());
    }
  }
```

- [ ] **Step 3: LIVE-Smoke-Block um Force/Callback-Log erweitern (kein harter Assert)**

Im bestehenden LIVE-Smoke-Abschnitt am Ende von `streckeninfo.selftest.ts` ergänzen (falls ein Live-Service instanziiert wird; sonst einen kleinen Zusatzblock anhängen):

```ts
// --- LIVE-Smoke: force + onRefresh (nur Logging) ---
{
  const isr = new IsrData();
  let refreshed = 0;
  const svc = new StreckenInfoService(isr.stations, { onRefresh: () => { refreshed++; } });
  try {
    await svc.getData();               // 1. echter Scrape -> refreshed=1
    await svc.getData();               // Cache-Treffer -> refreshed bleibt 1
    await svc.getData({ force: true }); // erzwungen -> refreshed=2
    console.log(`[live] onRefresh-Aufrufe (erwartet 2): ${refreshed}`);
  } catch (e) {
    console.log('[live] uebersprungen (kein Netz):', (e as Error).message);
  }
}
```

- [ ] **Step 4: Offline-Tests weiter grün**

Run: `npx tsx src/data/streckeninfo.selftest.ts`
Expected: PASS (Offline-Asserts). Live-Zeilen loggen nur; bei fehlendem Netz erscheint „uebersprungen".

- [ ] **Step 5: Typecheck + Commit**

Run: `npm run typecheck` (keine Fehler)

```bash
git add src/data/streckeninfo.ts src/data/streckeninfo.selftest.ts
git commit -m "feat(streckeninfo): getData(force) + onRefresh-Callback"
```

---

### Task 4: `SseHub` (SSE-Client-Verwaltung)

**Files:**
- Create: `src/server/sse-hub.ts`
- Test: `src/server/sse-hub.selftest.ts`

**Interfaces:**
- Produces:
  - `class SseHub`
  - `addClient(res: ServerResponse): void` — SSE-Header + Registrierung + Cleanup bei `close`.
  - `broadcast(event: string): void` — sendet `event: <name>\ndata: {}\n\n` an alle Clients.
  - `get clientCount(): number`

- [ ] **Step 1: Failing test `src/server/sse-hub.selftest.ts`**

```ts
// Selbsttest fuer den SseHub. Laufbar mit: npx tsx src/server/sse-hub.selftest.ts
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { SseHub } from './sse-hub.js';

/** Minimales ServerResponse-Double: sammelt geschriebene Frames, feuert 'close'. */
class FakeRes extends EventEmitter {
  head: { code: number; headers: Record<string, string> } | null = null;
  chunks: string[] = [];
  writeHead(code: number, headers: Record<string, string>): this {
    this.head = { code, headers };
    return this;
  }
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
}

{
  const hub = new SseHub();
  const a = new FakeRes();
  const b = new FakeRes();

  hub.addClient(a as unknown as ServerResponse);
  hub.addClient(b as unknown as ServerResponse);
  assert.strictEqual(hub.clientCount, 2, 'zwei Clients registriert');
  assert.strictEqual(a.head?.code, 200, 'SSE-Header 200');
  assert.match(a.head?.headers['Content-Type'] ?? '', /text\/event-stream/, 'event-stream MIME');

  hub.broadcast('streckeninfo');
  assert.ok(
    a.chunks.some((c) => c.includes('event: streckeninfo')),
    'Client a hat Event erhalten',
  );
  assert.ok(b.chunks.some((c) => c.includes('event: streckeninfo')), 'Client b hat Event erhalten');

  a.emit('close');
  assert.strictEqual(hub.clientCount, 1, 'Client a nach close entfernt');

  hub.broadcast('streckeninfo'); // darf nicht werfen, obwohl a geschlossen ist
  console.log('SseHub OK');
}
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `npx tsx src/server/sse-hub.selftest.ts`
Expected: FAIL — Modul `./sse-hub.js` existiert nicht.

- [ ] **Step 3: `src/server/sse-hub.ts` implementieren**

```ts
// Verwaltet Server-Sent-Events-Clients und broadcastet Refresh-Signale.
// Verantwortung: SSE-Verbindungsverwaltung (SRP). Kennt keine Fachinhalte.
import type { ServerResponse } from 'node:http';

export class SseHub {
  private clients = new Set<ServerResponse>();

  /** Registriert eine offene Response als SSE-Stream. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 5000\n\n'); // Reconnect-Hinweis fuer EventSource
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /** Sendet ein (datenloses) Event an alle Clients; tote Clients werden entfernt. */
  broadcast(event: string): void {
    const frame = `event: ${event}\ndata: {}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(frame);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `npx tsx src/server/sse-hub.selftest.ts`
Expected: PASS („SseHub OK").

- [ ] **Step 5: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add src/server/sse-hub.ts src/server/sse-hub.selftest.ts
git commit -m "feat(server): SseHub fuer SSE-Push"
```

---

### Task 5: SSE-Route im `ApiRouter` + Verdrahtung in `main.ts`

**Files:**
- Modify: `src/server/api-router.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `SseHub` (Task 4), `StreckenInfoService.onRefresh` (Task 3).
- Produces: HTTP-Route `GET /api/streckeninfo/events` → offener SSE-Stream.

- [ ] **Step 1: `ApiRouter` um `SseHub` erweitern**

Import ergänzen und Konstruktor-Parameter hinzufügen:

```ts
import type { SseHub } from './sse-hub.js';
```

Konstruktor:

```ts
  constructor(
    private routes: RouteService,
    private suggester: StationSuggester,
    private search: EntitySearch,
    private streckeninfo: StreckenInfoService,
    private sse: SseHub,
  ) {}
```

Im `switch` von `handle(...)` vor `default:` einfügen:

```ts
      case '/api/streckeninfo/events':
        this.sse.addClient(res); // Response bleibt offen (kein json())
        return true;
```

- [ ] **Step 2: `main.ts` verdrahten**

Import ergänzen:

```ts
import { SseHub } from './server/sse-hub.js';
```

Die Verdrahtung (aktuell Zeilen ~28–30) ersetzen:

```ts
const routeService = new RouteService(data.graph, data.stations);
const sseHub = new SseHub();
const streckeninfo = new StreckenInfoService(data.stations, {
  apiBase: STRECKENINFO_API,
  wsUrl: STRECKENINFO_WS,
  ttlMs: STRECKENINFO_TTL_MS,
  onRefresh: () => sseHub.broadcast('streckeninfo'),
});
const apiRouter = new ApiRouter(routeService, data.stations, data.search, streckeninfo, sseHub);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 4: Manuelle Prüfung (Server + SSE)**

Run (Hintergrund): `npm start` — warten bis „Karte: http://localhost:…".
In zweitem Terminal:
`curl -N http://localhost:3000/api/streckeninfo/events` (Port ggf. aus Ausgabe).
Expected: Verbindung bleibt offen; nach einem `curl http://localhost:3000/api/streckeninfo` (löst frischen Scrape aus, sofern Cache leer/abgelaufen) erscheint eine `event: streckeninfo`-Zeile im ersten Terminal. Danach `npm start` beenden.

> Falls kein Netz zu strecken-info.de: der SSE-Kanal steht trotzdem; ein Event erscheint erst bei erfolgreichem Scrape. Das ist akzeptabel.

- [ ] **Step 5: Commit**

```bash
git add src/server/api-router.ts src/main.ts
git commit -m "feat(server): /api/streckeninfo/events + SSE-Verdrahtung"
```

---

### Task 6: `ansi.wrap` + Input-Handler für Meldungs-Modus

**Files:**
- Modify: `src/tui/ansi.ts`
- Modify: `src/tui/input-handler.ts`
- Modify: `src/tui/tui-renderer.ts` (nur Export des Mode-Typs)
- Test: `src/tui/tui.selftest.ts` (neu)

**Interfaces:**
- Produces:
  - `src/tui/ansi.ts`: `export function wrap(text: string, width: number): string[]` — Wortumbruch auf sichtbare Breite (Eingabe ohne ANSI-Codes).
  - `src/tui/tui-renderer.ts`: `export type TuiMode = 'list' | 'detail' | 'meldungen'`.
  - `src/tui/input-handler.ts`: `parse(key: string, mode: TuiMode): TuiAction`; neue Aktionen `{ type: 'meldungen-open' }`, `{ type: 'refresh' }`.

- [ ] **Step 1: Failing test `src/tui/tui.selftest.ts` (Teil A: wrap + input)**

```ts
// Selbsttest fuer TUI-Bausteine (ansi.wrap, InputHandler, Renderer).
// Laufbar mit: npx tsx src/tui/tui.selftest.ts
import assert from 'node:assert';
import { wrap } from './ansi.js';
import { InputHandler } from './input-handler.js';

// --- ansi.wrap ---
{
  assert.deepStrictEqual(wrap('', 10), [''], 'leerer Text -> eine leere Zeile');
  assert.deepStrictEqual(wrap('abc', 10), ['abc'], 'kurz -> eine Zeile');
  const r = wrap('aaa bbb ccc ddd', 7);
  assert.ok(r.every((l) => l.length <= 7), 'jede Zeile <= Breite');
  assert.strictEqual(r.join(' '), 'aaa bbb ccc ddd', 'Worte bleiben erhalten');
  // ueberlanges Einzelwort wird hart geschnitten
  assert.ok(wrap('abcdefghij', 4).every((l) => l.length <= 4), 'langes Wort hart umbrochen');
}

// --- InputHandler ---
{
  const h = new InputHandler();
  assert.deepStrictEqual(h.parse('\x02', 'list'), { type: 'meldungen-open' }, 'Ctrl+B oeffnet Meldungen');
  assert.deepStrictEqual(h.parse('a', 'list'), { type: 'char', ch: 'a' }, 'Buchstabe -> char in Liste');
  assert.deepStrictEqual(h.parse('r', 'meldungen'), { type: 'refresh' }, 'r -> refresh in Meldungen');
  assert.deepStrictEqual(h.parse('\x1b[A', 'meldungen'), { type: 'up' }, 'Pfeil hoch scrollt Meldungen');
  assert.deepStrictEqual(h.parse('\x1b', 'meldungen'), { type: 'back' }, 'Esc -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('q', 'meldungen'), { type: 'back' }, 'q -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('\r', 'meldungen'), { type: 'back' }, 'Enter -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('\x03', 'list'), { type: 'quit' }, 'Ctrl+C beendet');
  // Detailmodus unveraendert
  assert.deepStrictEqual(h.parse('\x1b', 'detail'), { type: 'back' }, 'Esc -> zurueck aus Detail');
}

console.log('TUI-Teil A (wrap, input) OK');
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `npx tsx src/tui/tui.selftest.ts`
Expected: FAIL — `wrap` nicht exportiert / `parse`-Signatur passt nicht.

- [ ] **Step 3: `wrap` in `src/tui/ansi.ts` ergänzen**

Am Ende von `ansi.ts`:

```ts
/**
 * Wortumbruch auf sichtbare Breite. Eingabe OHNE ANSI-Codes.
 * Ueberlange Einzelwoerter werden hart geschnitten. Leerer Text -> [''].
 */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const rawLine of String(text).split('\n')) {
    let line = '';
    for (const word of rawLine.split(/\s+/).filter((x) => x.length > 0)) {
      let word2 = word;
      while (word2.length > w) {
        // Wort laenger als Zeile: harten Rest abschneiden.
        if (line) { out.push(line); line = ''; }
        out.push(word2.slice(0, w));
        word2 = word2.slice(w);
      }
      if (!line) line = word2;
      else if (line.length + 1 + word2.length <= w) line += ' ' + word2;
      else { out.push(line); line = word2; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}
```

- [ ] **Step 4: Mode-Typ in `src/tui/tui-renderer.ts` exportieren**

Über dem `TuiState`-Interface einfügen und `mode` darauf umstellen:

```ts
export type TuiMode = 'list' | 'detail' | 'meldungen';
```

Im `TuiState` das Feld ändern: `mode: TuiMode;` (statt `'list' | 'detail'`).

- [ ] **Step 5: `src/tui/input-handler.ts` umstellen**

`TuiAction` um zwei Varianten erweitern und `TuiMode` importieren:

```ts
import type { TuiMode } from './tui-renderer.js';

export type TuiAction =
  | { type: 'quit' }
  | { type: 'char'; ch: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'filter-next' }
  | { type: 'filter-prev' }
  | { type: 'meldungen-open' }
  | { type: 'refresh' }
  | { type: 'none' };
```

`parse` komplett ersetzen:

```ts
  /** @param mode aktueller TUI-Modus (aendert Bedeutung mancher Tasten). */
  parse(key: string, mode: TuiMode): TuiAction {
    if (key === '\x03') return { type: 'quit' }; // Ctrl+C

    if (mode === 'meldungen') {
      switch (key) {
        case '\x1b': case 'q': case '\r': case '\n': return { type: 'back' };
        case '\x1b[A': return { type: 'up' };
        case '\x1b[B': return { type: 'down' };
        case 'r': return { type: 'refresh' };
        default: return { type: 'none' };
      }
    }

    if (mode === 'detail') {
      switch (key) {
        case '\x1b': case 'q': case '\r': case '\n': return { type: 'back' };
        case '\x1b[A': return { type: 'up' };
        case '\x1b[B': return { type: 'down' };
        default: return { type: 'none' };
      }
    }

    // Listen-/Suchmodus
    switch (key) {
      case '\x02': return { type: 'meldungen-open' }; // Ctrl+B: Betriebslage
      case '\t': return { type: 'filter-next' };
      case '\x1b[Z': return { type: 'filter-prev' };
      case '\x1b[A': return { type: 'up' };
      case '\x1b[B': return { type: 'down' };
      case '\r': case '\n': return { type: 'enter' };
      case '\x7f': case '\x08': return { type: 'backspace' };
      case '\x1b': return { type: 'clear' };
      default:
        if (key >= ' ' && key.length === 1) return { type: 'char', ch: key };
        return { type: 'none' };
    }
  }
```

- [ ] **Step 6: Test ausführen (muss bestehen)**

Run: `npx tsx src/tui/tui.selftest.ts`
Expected: PASS („TUI-Teil A (wrap, input) OK"). Renderer-Teil folgt in Task 7.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: In `tui-app.ts` erscheint jetzt evtl. ein Fehler, weil `this.input.parse(key, this.state.mode === 'detail')` einen Boolean statt `TuiMode` übergibt. **Das wird in Task 8 behoben.** Falls der Typecheck hier rot ist, ist das erwartet — mit Task 7/8 fortfahren und erst danach committen.

- [ ] **Step 8: Commit (zusammen mit Task 7 wenn Typecheck erst dann grün)**

Siehe Task 7, Step-Ende (gemeinsamer Commit möglich). Wenn `npm run typecheck` bereits grün ist (weil `tui-app.ts` noch mit Boolean toleriert wird — ist es nicht), separat committen. Andernfalls Commit ans Ende von Task 8.

---

### Task 7: Renderer-State + `renderMeldungen`

**Files:**
- Modify: `src/tui/tui-renderer.ts`
- Test: `src/tui/tui.selftest.ts` (Teil B: Renderer)

**Interfaces:**
- Consumes: `StreckenInfoResult`, `StoerungMeldungDTO`, `SammelmeldungDTO` (types), `wrap` (ansi).
- Produces:
  - `interface MeldungenView { status: 'idle' | 'loading' | 'refreshing' | 'ready'; data: StreckenInfoResult | null }`
  - `TuiState` zusätzlich: `meldungen: MeldungenView; meldungenScroll: number`.
  - `render(...)` behandelt `mode === 'meldungen'` (private `renderMeldungen`).

- [ ] **Step 1: Failing test in `src/tui/tui.selftest.ts` (Teil B) ergänzen**

Vor der letzten `console.log`-Zeile einfügen. Zuerst Imports oben in der Datei erweitern:

```ts
import { TuiRenderer, type TuiState, type MeldungenView } from './tui-renderer.js';
import { stripAnsi } from './ansi.js';
import type { AbschnittLookup } from '../types.js';
```

Dann der Testblock:

```ts
// --- Renderer: renderMeldungen ---
{
  const abschnitte: AbschnittLookup = { byStrecke: () => [] };
  const rend = new TuiRenderer(abschnitte);
  const ctx = { url: 'http://x/', requestCount: 0, totalObjects: 0 };

  const baseState = (meldungen: MeldungenView): TuiState => ({
    query: '', results: [], sel: 0, mode: 'meldungen', detailScroll: 0,
    filter: null, meldungen, meldungenScroll: 0,
  });

  // loading
  const loading = stripAnsi(rend.render(baseState({ status: 'loading', data: null }), ctx, 100, 24));
  assert.match(loading, /Lade Meldungen/, 'loading-Text');

  // ready mit einer Stoerung + einer Sammelmeldung
  const data = {
    stoerungen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    baustellen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    streckenruhen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    sammelmeldungen: [{ key: 's1', cause: 'Sammelursache', subcause: '', text: 'Sammeltext',
      beginn: '', ende: '', verkehrsarten: ['FV'] }],
    stoerungenListe: [{ key: 'x1', cause: 'Signalstoerung', subcause: 'Detail', text: 'Kaputtes Signal',
      beginn: '2026-07-08T10:00:00', ende: '', verkehrsarten: ['NV'], gleisEinschraenkung: 'SCHWER',
      verortet: false }],
    generatedAt: '2026-07-08T10:00:00.000Z',
    counts: { stoerungen: 0, stoerungenOhneOrt: 1, baustellen: 0, streckenruhen: 0, sammelmeldungen: 1 },
    error: null,
  };
  const ready = stripAnsi(rend.render(baseState({ status: 'ready', data }), ctx, 100, 24));
  assert.match(ready, /Störungen \(1\)/, 'Stoerungs-Ueberschrift mit Anzahl');
  assert.match(ready, /Sammelmeldungen \(1\)/, 'Sammelmeldungs-Ueberschrift mit Anzahl');
  assert.match(ready, /Signalstoerung/, 'Stoerungs-cause sichtbar');
  assert.match(ready, /Kaputtes Signal/, 'Stoerungs-text sichtbar');
  assert.match(ready, /ohne Ort/, 'Marker fuer nicht verortete Stoerung');

  // error
  const errData = { ...data, error: 'Netzfehler' };
  const err = stripAnsi(rend.render(baseState({ status: 'ready', data: errData }), ctx, 100, 24));
  assert.match(err, /Netzfehler/, 'Fehlertext sichtbar');

  // empty
  const emptyData = { ...data, sammelmeldungen: [], stoerungenListe: [], error: null };
  const empty = stripAnsi(rend.render(baseState({ status: 'ready', data: emptyData }), ctx, 100, 24));
  assert.match(empty, /Keine aktuellen Meldungen/, 'Leer-Hinweis');
}
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `npx tsx src/tui/tui.selftest.ts`
Expected: FAIL — `MeldungenView` nicht exportiert / `render` behandelt `meldungen` nicht.

- [ ] **Step 3: State-Typen in `src/tui/tui-renderer.ts` ergänzen**

Imports oben erweitern:

```ts
import { ESC, bold, dim, inv, c, pad, stripAnsi, wrap, KIND_COLOR } from './ansi.js';
import type { AbschnittLookup, AbschnittProps, SearchEntry } from '../types.js';
import type { StreckenInfoResult, StoerungMeldungDTO, SammelmeldungDTO } from '../types.js';
```

`MeldungenView` + `TuiState`-Felder ergänzen (nach `TuiMode`):

```ts
export interface MeldungenView {
  status: 'idle' | 'loading' | 'refreshing' | 'ready';
  data: StreckenInfoResult | null;
}

export interface TuiState {
  query: string;
  results: SearchEntry[];
  sel: number;
  mode: TuiMode;
  detailScroll: number;
  filter: SearchEntry['kind'] | null;
  meldungen: MeldungenView;
  meldungenScroll: number;
}
```

- [ ] **Step 4: `render`-Dispatch erweitern**

In `render(...)` den Modus-Zweig ergänzen (ersetzt die bestehende if/else-Zeile):

```ts
    if (state.mode === 'detail') this.renderDetail(state, W, H, lines);
    else if (state.mode === 'meldungen') this.renderMeldungen(state, W, H, lines);
    else this.renderList(state, W, H, lines);
```

Die Fußzeile ebenfalls modusabhängig machen — ersetze den `lines[H - 1] = …`-Block:

```ts
    const footer = state.mode === 'detail'
      ? '↑↓ scrollen   ·   Esc/Enter: zurück   ·   Ctrl+C: beenden'
      : state.mode === 'meldungen'
      ? '↑↓ scrollen   ·   r: aktualisieren   ·   Esc/q: zurück   ·   Ctrl+C: beenden'
      : '↑↓ wählen   ·   Enter: Details   ·   Ctrl+B: Meldungen   ·   Tab: Typ filtern   ·   Esc: leeren   ·   Ctrl+C: beenden';
    lines[H - 1] = dim(' ' + footer);
```

- [ ] **Step 5: `renderMeldungen` implementieren**

Als neue private Methode in `TuiRenderer` (z. B. nach `renderDetail`):

```ts
  /** Betriebslage-Ansicht: Stoerungen + Sammelmeldungen, scrollbar. */
  private renderMeldungen(state: TuiState, W: number, H: number, lines: string[]): void {
    const mv = state.meldungen;
    lines.push(bold(c('31', ' Betriebslage — Meldungen')));
    if (mv.status === 'loading') { lines.push(''); lines.push(dim(' Lade Meldungen …')); return; }
    if (mv.status === 'refreshing') lines.push(dim(' Aktualisiere …'));
    const data = mv.data;
    if (!data) { lines.push(''); lines.push(dim(' Keine Daten.')); return; }
    if (data.error) lines.push(c('31', ' Fehler: ' + data.error));
    lines.push(dim(' Stand: ' + data.generatedAt));
    lines.push(dim('─'.repeat(W)));

    const body: string[] = [];
    const st = data.stoerungenListe;
    const sm = data.sammelmeldungen;
    if (st.length === 0 && sm.length === 0 && !data.error) {
      body.push(dim(' Keine aktuellen Meldungen.'));
    }
    if (st.length > 0) {
      body.push(bold(` Störungen (${st.length})`));
      for (const m of st) this.meldungBlock(body, m.cause, m.subcause, m.text,
        m.beginn, m.ende, m.verkehrsarten, m.gleisEinschraenkung, m.verortet ? '' : 'ohne Ort', W);
    }
    if (sm.length > 0) {
      if (st.length > 0) body.push('');
      body.push(bold(` Sammelmeldungen (${sm.length})`));
      for (const m of sm) this.meldungBlock(body, m.cause, m.subcause, m.text,
        m.beginn, m.ende, m.verkehrsarten, '', '', W);
    }

    const avail = H - lines.length - 2;
    const maxScroll = Math.max(0, body.length - avail);
    const scroll = Math.min(state.meldungenScroll, maxScroll);
    for (const line of body.slice(scroll, scroll + avail)) lines.push(line);
    if (maxScroll > 0) {
      const shown = Math.min(scroll + avail, body.length);
      lines.push(dim(` — Zeile ${scroll + 1}–${shown} von ${body.length}${scroll < maxScroll ? '  ↓ mehr' : ''} —`));
    }
  }

  /** Ein Meldungs-Block: Titelzeile + umgebrochener Text + Metazeile. */
  private meldungBlock(
    body: string[], cause: string, subcause: string, text: string,
    beginn: string, ende: string, verkehrsarten: string[],
    gleis: string, marker: string, W: number,
  ): void {
    const titel = [cause || 'Meldung', subcause].filter(Boolean).join(' – ');
    const mk = marker ? '  ' + dim('(' + marker + ')') : '';
    body.push(' ' + c('33', titel) + mk);
    for (const zeile of wrap(String(text).trim(), Math.max(20, W - 3))) {
      if (zeile) body.push('   ' + zeile);
    }
    const meta: string[] = [];
    const zeit = [beginn, ende].filter(Boolean).join(' – ');
    if (zeit) meta.push(zeit);
    if (verkehrsarten.length) meta.push(verkehrsarten.join('/'));
    if (gleis) meta.push('Gleis: ' + gleis);
    if (meta.length) body.push('   ' + dim(meta.join('   ·   ')));
  }
```

- [ ] **Step 6: Test ausführen (muss bestehen)**

Run: `npx tsx src/tui/tui.selftest.ts`
Expected: PASS (Teil A + B). Abschluss-Log erscheint.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: nur noch der bekannte `tui-app.ts`-Fehler (parse-Argument + fehlende State-Felder) — wird in Task 8 behoben.

- [ ] **Step 8: Commit (Task 6 + 7)**

```bash
git add src/tui/ansi.ts src/tui/input-handler.ts src/tui/tui-renderer.ts src/tui/tui.selftest.ts
git commit -m "feat(tui): Meldungs-Ansicht (renderMeldungen), wrap, Input-Modi"
```

---

### Task 8: `TuiApp`-Orchestrierung + `main.ts`-Verdrahtung

**Files:**
- Modify: `src/tui/tui-app.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `MeldungenProvider` (types), erweitertes `TuiState`/`MeldungenView` (Task 7), `parse(key, mode)` (Task 6).
- Produces: `TuiApp`-Konstruktor mit zusätzlichem `meldungen: MeldungenProvider`-Parameter.

- [ ] **Step 1: `TuiApp` erweitern**

Import ergänzen:

```ts
import type { EntitySearch, MeldungenProvider } from '../types.js';
```

Initialen State um die neuen Felder erweitern:

```ts
  private state: TuiState = {
    query: '', results: [], sel: 0, mode: 'list', detailScroll: 0, filter: null,
    meldungen: { status: 'idle', data: null }, meldungenScroll: 0,
  };
```

Konstruktor um die Abhängigkeit erweitern (vor `opts`):

```ts
  constructor(
    private search: EntitySearch,
    private renderer: TuiRenderer,
    private input: InputHandler,
    private meldungen: MeldungenProvider,
    private opts: TuiAppOptions,
  ) {}
```

- [ ] **Step 2: `onKey` anpassen (parse-Argument + neue Aktionen + Scroll)**

`this.input.parse(...)`-Aufruf umstellen und die neuen Cases ergänzen:

```ts
  private onKey(key: string): void {
    const action = this.input.parse(key, this.state.mode);
    const s = this.state;
    switch (action.type) {
      case 'quit': this.cleanup(); this.opts.onQuit(); return;
      case 'char': s.query += action.ch; this.updateResults(); break;
      case 'backspace': s.query = s.query.slice(0, -1); this.updateResults(); break;
      case 'clear': s.query = ''; this.updateResults(); break;
      case 'up':
        if (s.mode === 'detail') s.detailScroll = Math.max(0, s.detailScroll - 1);
        else if (s.mode === 'meldungen') s.meldungenScroll = Math.max(0, s.meldungenScroll - 1);
        else s.sel = Math.max(0, s.sel - 1);
        break;
      case 'down':
        if (s.mode === 'detail') s.detailScroll += 1;
        else if (s.mode === 'meldungen') s.meldungenScroll += 1;
        else s.sel = Math.min(s.results.length - 1, s.sel + 1);
        break;
      case 'enter': if (s.results.length) { s.mode = 'detail'; s.detailScroll = 0; } break;
      case 'back': s.mode = 'list'; break;
      case 'filter-next': this.cycleFilter(1); break;
      case 'filter-prev': this.cycleFilter(-1); break;
      case 'meldungen-open': this.openMeldungen(); break;
      case 'refresh': this.refreshMeldungen(); break;
      case 'none': return;
    }
    this.draw();
  }
```

- [ ] **Step 3: Lade-/Refresh-Methoden ergänzen**

Neue private Methoden in `TuiApp`:

```ts
  private openMeldungen(): void {
    const s = this.state;
    s.mode = 'meldungen';
    s.meldungenScroll = 0;
    if (!s.meldungen.data) {
      s.meldungen = { status: 'loading', data: null };
      this.loadMeldungen(false);
    }
  }

  private refreshMeldungen(): void {
    if (this.state.mode !== 'meldungen') return;
    this.state.meldungen = { status: 'refreshing', data: this.state.meldungen.data };
    this.loadMeldungen(true);
  }

  /** Holt Daten (ggf. erzwungen) und zeichnet neu, wenn die Ansicht noch offen ist. */
  private loadMeldungen(force: boolean): void {
    void this.meldungen.getData(force ? { force: true } : undefined).then((data) => {
      this.state.meldungen = { status: 'ready', data };
      if (this.state.mode === 'meldungen') this.draw();
    });
  }
```

- [ ] **Step 4: `main.ts` — Provider in `TuiApp` injizieren**

Den `TuiApp`-Konstruktoraufruf (aktuell Zeilen ~37–40) anpassen: `streckeninfo` als 4. Argument:

```ts
const tui = new TuiApp(data.search, new TuiRenderer(data.abschnitte), new InputHandler(), streckeninfo, {
  getContext: () => ({ url, requestCount: httpServer.requestCount, totalObjects: data.search.entries.length }),
  onQuit: shutdown,
});
```

- [ ] **Step 5: Typecheck (jetzt vollständig grün)**

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 6: Alle Selftests erneut ausführen**

Run: `npx tsx src/data/streckeninfo.selftest.ts && npx tsx src/server/sse-hub.selftest.ts && npx tsx src/tui/tui.selftest.ts`
Expected: alle PASS.

- [ ] **Step 7: Manuelle TUI-Prüfung**

Run: `npm start`. In der TUI:
- `Ctrl+B` drücken → „Betriebslage — Meldungen" erscheint; kurz „Lade Meldungen …", dann Störungen/Sammelmeldungen (oder „Keine aktuellen Meldungen." / Fehlerzeile bei fehlendem Netz).
- `↑/↓` scrollt; `r` zeigt kurz „Aktualisiere …" und lädt neu; `Esc` kehrt zur Suche zurück.
Danach `Ctrl+C`.

- [ ] **Step 8: Commit**

```bash
git add src/tui/tui-app.ts src/main.ts
git commit -m "feat(tui): TuiApp-Orchestrierung fuer Meldungen + Refresh"
```

---

### Task 9: Frontend — Karte via SSE aktualisieren

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: Route `GET /api/streckeninfo/events` (Task 5), bestehende `loadStreckenInfo()`.

- [ ] **Step 1: EventSource-Anbindung ergänzen**

In `public/index.html` direkt nach der Zeile
`setInterval(loadStreckenInfo, 180000);   // alle 3 Minuten aktualisieren`
einfügen:

```js
  // Live-Push: nach einem TUI-/TTL-Refresh sofort neu laden (Poll bleibt Sicherheitsnetz).
  try {
    const siEvents = new EventSource('/api/streckeninfo/events');
    siEvents.addEventListener('streckeninfo', () => loadStreckenInfo());
  } catch (e) { /* EventSource nicht verfügbar -> Poll genügt */ }
```

- [ ] **Step 2: Manuelle End-to-End-Prüfung**

Run: `npm start`. Browser auf die angezeigte URL öffnen, DevTools → Network → `events` sollte als offener `eventsource`-Request stehen.
In der TUI `Ctrl+B`, dann `r` drücken. Erwartung: Kurz darauf feuert `loadStreckenInfo()` im Browser erneut (Network zeigt einen neuen `/api/streckeninfo`-Request; die Störungs-Statuszeile/Overlays aktualisieren sich). Danach `Ctrl+C`.

> Ohne Netz zu strecken-info.de bleibt der Dateninhalt leer, aber der `/api/streckeninfo`-Request nach dem Event ist trotzdem im Network sichtbar — das verifiziert den SSE-Pfad.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(web): Karte via SSE-Push aktualisieren"
```

---

## Self-Review (durchgeführt)

- **Spec-Abdeckung:** Störungen+Sammelmeldungen in TUI (Task 6–8), geteilter Service/DIP-Port (Task 1, 8, main), `stoerungenListe` inkl. ohne-Ort (Task 2), Ctrl+B/r/Esc (Task 6), SSE-Push + `onRefresh` entkoppelt (Task 3–5), Frontend-EventSource + Poll bleibt (Task 9), Tests (Task 2, 4, 6, 7). ✔
- **Platzhalter:** keine — jeder Code-Schritt zeigt vollständigen Code.
- **Typkonsistenz:** `MeldungenProvider.getData(opts?: {force?})`, `StreckenInfoResult.stoerungenListe`, `StoerungMeldungDTO.verortet`, `TuiMode`, `MeldungenView`, `parse(key, mode)`, `SseHub.broadcast('streckeninfo')` / Frontend `addEventListener('streckeninfo')` — durchgängig gleich benannt. ✔
- **Zwischenzustände:** Task 1 lässt `tsc` bewusst kurz rot (Feld fehlt bis Task 2); Task 6/7 lassen `tui-app.ts` rot bis Task 8. Commits erfolgen nur an grünen Punkten (Task 2, 3, 4, 5, 7, 8, 9). ✔
