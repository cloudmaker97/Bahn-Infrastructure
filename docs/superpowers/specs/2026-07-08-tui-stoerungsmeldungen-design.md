# Störungsmeldungen in der TUI + Live-Refresh

**Datum:** 2026-07-08
**Status:** Design abgenommen

## Ziel

Die Betriebslage von strecken-info.de (aktuell nur im Web-Frontend als Karten-Overlays
sichtbar) soll auch in der TUI erscheinen — konkret die **Störungen + Sammelmeldungen**
als lesbare Textmeldungen. Zusätzlich soll die Taste **`r`** in der TUI einen frischen
Scrape auslösen und sowohl TUI als auch Karte aktualisieren.

## Leitplanken (SOLID / Single Source of Truth)

- **Kein doppelter Scrape-Code.** Der bereits existierende `StreckenInfoService`
  (Composition Root [main.ts](../../../src/main.ts)) ist die einzige Datenquelle. Dieselbe
  Instanz wird von `ApiRouter` (Web) und `TuiApp` (TUI) genutzt — geteilter TTL-Cache,
  kein HTTP-Selbstgespräch der TUI.
- **DIP/ISP:** Die TUI hängt an einem schmalen Port `MeldungenProvider`, nicht an der
  konkreten Service-Klasse (Muster der bestehenden „Abstraktionen" in
  [types.ts](../../../src/types.ts)).
- **SRP:** Rendering (pure), Eingabe-Parsing, Ablaufsteuerung und SSE-Verwaltung bleiben
  getrennte Units. Der Datenservice weiß nichts von HTTP/SSE.

## Umfang (abgestimmt)

1. **Anzeige:** Störungen + Sammelmeldungen (keine Baustellen/Streckenruhen).
2. **Datenzugriff:** gemeinsamer `StreckenInfoService` in-process (kein HTTP-Umweg).
3. **Bedienung:** eigener TUI-Ansichtsmodus, geöffnet per Taste.
4. **Refresh:** Taste `r` erzwingt frischen Scrape → TUI sofort, Karte via SSE-Push.

## Architektur

### 1. Datenvertrag — Service-Erweiterung ([streckeninfo.ts](../../../src/data/streckeninfo.ts))

Problem: `baueGeoJson` verwirft aktuell **nicht verortete** Störungen aus
`stoerungen.features` und zählt sie nur als `stoerungenOhneOrt`. Für eine textbasierte
Meldungsansicht wäre genau das falsch weggelassen.

Lösung — additiv, ohne die bestehenden Felder zu ändern:

```ts
export interface StoerungMeldungDTO {
  key: string;
  cause: string;
  subcause: string;
  text: string;
  beginn: string;
  ende: string;
  verkehrsarten: string[];        // flach dedupliziert (wie Sammelmeldung)
  gleisEinschraenkung: string;
  verortet: boolean;              // hat die Störung eine auflösbare Geometrie?
}
```

- `StreckenInfoResult` bekommt neu: `stoerungenListe: StoerungMeldungDTO[]`.
- Reine Funktion `toStoerungMeldungDTO(s: RawStoerung, verortet: boolean)`.
- In `baueGeoJson`: `stoerungenListe` aus **allen** aktiven Nicht-Sammelmeldungs-Störungen
  (`stoerungenAlle`) bauen; `verortet = geometry !== null`. Karten-Features und `counts`
  bleiben unverändert. Das Web ignoriert das neue Feld (unschädlicher, additiver
  Vertrag). Leichte Text-Dopplung verorteter Störungen im Payload ist bei der
  Datenmenge vernachlässigbar.

### 2. Force-Refresh + Push-Callback ([streckeninfo.ts](../../../src/data/streckeninfo.ts))

- `getData(opts?: { force?: boolean }): Promise<StreckenInfoResult>` — bei `force` wird
  der TTL-Cache übergangen und frisch gescraped; Cache + `generatedAt` werden aktualisiert.
- Konstruktor-Option `onRefresh?: () => void`. Der Service ruft diesen Callback **nur
  nach einem echten Netz-Scrape** (nicht bei Cache-Treffern). Damit bleibt der Service
  von HTTP/SSE entkoppelt (DIP): er kennt nur eine parameterlose Benachrichtigungs-Funktion.
- `getData()` wirft weiterhin nie — Fehler stehen im `error`-Feld.

### 3. Port ([types.ts](../../../src/types.ts))

```ts
/** Nur die fuer die TUI noetige Sicht auf die Betriebslage. */
export interface MeldungenProvider {
  getData(opts?: { force?: boolean }): Promise<StreckenInfoResult>;
}
```

`StreckenInfoService` erfüllt diesen Port bereits.

**Import-Richtung (wichtig):** `types.ts` ist der gemeinsame Vertrags-Ort, und
`streckeninfo.ts` importiert bereits aus `types.ts` (nicht umgekehrt). Damit der Port
`MeldungenProvider` auf den Datentyp verweisen kann, **wandern der öffentliche
Datenvertrag `StreckenInfoResult`, `SammelmeldungDTO` und der neue `StoerungMeldungDTO`
von `streckeninfo.ts` nach `types.ts`**. `streckeninfo.ts` importiert sie dann von dort
(analog zu `FeatureCollection`/`GeoFeature`/`StationLookup`). Die reinen Funktionen und
die `StreckenInfoService`-Klasse bleiben in `streckeninfo.ts`.

### 4. SSE-Push (Server → Browser)

- **Neu: `SseHub`** ([src/server/sse-hub.ts](../../../src/server/sse-hub.ts), SRP)
  - `addClient(res: ServerResponse): void` — schreibt SSE-Header
    (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`),
    registriert den Client, entfernt ihn bei `res`-`close`.
  - `broadcast(event: string): void` — sendet `event: <name>\ndata: {}\n\n` an alle Clients.
  - Optionaler Heartbeat (Kommentar-Zeile `:\n\n`) hält Proxies offen — nur falls nötig.
  - Kennt **keine** Streckeninfo-Inhalte.
- **`ApiRouter`** ([api-router.ts](../../../src/server/api-router.ts)): neue Behandlung von
  `GET /api/streckeninfo/events` → `sseHub.addClient(res)` (kein `json()`; Response bleibt
  offen). `ApiRouter` bekommt `SseHub` als Konstruktor-Abhängigkeit.
- **Verdrahtung** ([main.ts](../../../src/main.ts)):
  - `const sseHub = new SseHub();`
  - Service mit `onRefresh: () => sseHub.broadcast('streckeninfo')`.
  - `sseHub` in `ApiRouter` injizieren.
- **Frontend** ([public/index.html](../../../public/index.html)):
  - `const es = new EventSource('/api/streckeninfo/events'); es.onmessage = () => loadStreckenInfo();`
    (bzw. `es.addEventListener('streckeninfo', …)`).
  - EventSource verbindet bei Abbruch automatisch neu.
  - Der bestehende 3-Minuten-`setInterval`-Poll **bleibt** als Sicherheitsnetz
    (Web-only-Nutzer, SSE-Abbrüche); derselbe Cache greift.

### 5. TUI

**Zustand** ([tui-renderer.ts](../../../src/tui/tui-renderer.ts), `TuiState`):
- `mode: 'list' | 'detail' | 'meldungen'`
- `meldungen: MeldungenView` mit
  `MeldungenView = { status: 'idle' | 'loading' | 'refreshing' | 'ready'; data: StreckenInfoResult | null }`
- `meldungenScroll: number`

**Eingabe** ([input-handler.ts](../../../src/tui/input-handler.ts)):
- `parse(key, mode)` statt `parse(key, inDetail)` — Verhalten je Modus.
- Neue Aktionen: `{ type: 'meldungen-open' }`, `{ type: 'refresh' }`.
- **Listen-/Suchmodus:** `Ctrl+B` (`\x02`, mnemonisch „Betriebslage") → `meldungen-open`.
  (Ein Buchstabe scheidet aus, da er ins Suchfeld getippt würde. `\x02` ist frei.)
- **Meldungs-Modus:** `↑/↓` → scroll; `r` → `refresh` (hier keine Sucheingabe, daher
  frei); `Esc`/`q`/`Enter` → `back` (zur Suche).

**Ablauf** ([tui-app.ts](../../../src/tui/tui-app.ts)):
- Neue Abhängigkeit `private meldungen: MeldungenProvider`.
- `meldungen-open`: `mode='meldungen'`, `meldungenScroll=0`; wenn `data==null` →
  `status='loading'`, `getData()` → State setzen + `draw()`. Dank TTL ist erneutes Öffnen
  sofort.
- `refresh`: `status='refreshing'`, `getData({ force:true })` → State setzen + `draw()`.
  Der Service-`onRefresh`-Callback pusht parallel das SSE-Event → Karte aktualisiert sich.
- `back`: `mode='list'`.
- Renderer bleibt seiteneffektfrei; alle Daten liegen im `TuiState`.

**Rendering** ([tui-renderer.ts](../../../src/tui/tui-renderer.ts), pure `renderMeldungen`):
- Kopf: „Betriebslage — Meldungen", `generatedAt`, ggf. `error`.
- Zustände: `loading` → „Lade Meldungen …"; `refreshing` → „Aktualisiere …"; leer → Hinweis.
- Zwei Abschnitte: „**Störungen (n)**" und „**Sammelmeldungen (n)**".
- Je Meldung ein Block: farbige `cause` – `subcause`-Zeile; wortumbrochener `text`
  (Breite `W`); gedimmt `beginn`–`ende`, `verkehrsarten`, ggf. `gleisEinschraenkung`;
  bei Störungen ohne Ort ein `(ohne Ort)`-Marker.
- Scrollen über `meldungenScroll` analog zur Detailansicht (Zeilen-Fenster + „↓ mehr").
- Fußzeile: `↑↓ scrollen · r: aktualisieren · Esc: zurück · Ctrl+C: beenden`.
- Kleiner reiner Wortumbruch-Helfer (in [ansi.ts](../../../src/tui/ansi.ts) neben `pad`/`stripAnsi`).

## Tests

- **[streckeninfo.selftest.ts](../../../src/data/streckeninfo.selftest.ts)** erweitern
  (bestehendes Offline-Fixture-Muster, `node:assert`, `npx tsx …`):
  - Eine **nicht verortete** Störung (kein `koordinaten`/`abschnitte`/`betriebsstellen`)
    erscheint in `stoerungenListe` mit `verortet:false`, aber **nicht** in
    `stoerungen.features`. Eine verortete erscheint in beiden.
  - `getData({ force:true })` löst den `onRefresh`-Callback aus, ein Cache-Treffer nicht
    (mit gemocktem/injiziertem Fetch bzw. reiner Cache-Logik prüfbar; kein echtes Netz).
- **Neu: `src/tui/tui-renderer.selftest.ts`** (pure Renderer-Tests):
  `renderMeldungen` für `loading`, `ready` (mit ≥1 Störung + ≥1 Sammelmeldung, inkl.
  „ohne Ort"), leer und `error` — Assert auf Vorkommen der Schlüsseltexte im Frame.

## Nicht im Umfang (YAGNI)

- Baustellen/Streckenruhen in der TUI.
- Auswahl/Detail-Drilldown einzelner Meldungen (die scrollbare Liste genügt).
- Server-seitiger periodischer Refresh-Scheduler (der Frontend-Poll bleibt Sicherheitsnetz).
- Server→Browser-Push von Routen-/Suchdaten (nur Streckeninfo).
