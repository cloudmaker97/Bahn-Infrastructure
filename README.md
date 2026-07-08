# ISR-Export — Infrastrukturregister Deutsche Bahn

Vollständiger Datenexport aller Strecken Deutschlands aus dem DB GeoViewer
(Infrastrukturregister / ISR), gescraped am **2026-07-07**.

## Quelle

- Anwendung: https://geoviewer.deutschebahn.com/maps/#/context/ISR/275618 (MapStore)
- Backend: **GeoServer WFS** — `https://geoviewer.deutschebahn.com/geoviewer-geoserver/ows`
- Der Viewer lädt seine Daten über offene WFS-`GetFeature`-Anfragen (OGC WFS 1.1.0,
  `outputFormat=json`). Es wurde **nicht** die Karte per Klick abgegrast, sondern
  der WFS direkt vollständig abgefragt — dadurch sind die Daten komplett und exakt.
- Datenstand (in allen Feldern): `LADE_ID=5336`, `JAHR=2026`.
- Koordinaten der `geo_*`-Dateien: **WGS84 (EPSG:4326)**, Reihenfolge [lon, lat].

## Kennzahlen

| Datensatz            | Anzahl  | Beschreibung                                   |
|----------------------|---------|------------------------------------------------|
| Strecken (Geometrie) | 3.387   | Streckengeometrien (Multi-Segmente)            |
| Streckennummern      | 1.701   | eindeutige `ISR_STRE_NR`                        |
| Streckenabschnitte   | 19.884  | Abschnitte mit von/bis-km + 171 Metadatenfeldern |
| Streckenübergänge    | 3.869   | Übergangsstellen zwischen zwei Strecken         |
| Betriebsstellen      | 11.313  | Betriebsstellen-Punkte mit Koordinaten          |
| Tunnel               | 721     | Tunnel (Name, Länge, Art, TSI, Brandkategorie) |
| Brücken              | 504     | Brücken (Name, Länge, km-Lage)                  |
| Bahnübergänge        | 15.248  | Bahnübergänge (Sicherungsart, Kreuzungspartner) |

## Schnellstart

Voraussetzung: **Node.js ≥ 18**. Dann:

```
npm install     # einmalig – installiert TypeScript + tsx (nur devDependencies)
npm start       # startet Server + Karte + Recherche-TUI
```

Oder per Doppelklick auf **`Karte_starten.bat`** (installiert bei Bedarf automatisch).
Der Server öffnet http://localhost:8000/ im Browser und zeigt im Terminal die TUI.

> **Daten:** Das `data/`-Verzeichnis ist nicht eingecheckt (`.gitignore`). Fehlen die
> Daten beim Start (frischer Checkout), lädt `npm start` sie **automatisch** vom
> DB-WFS und baut die Web-GeoJSON — der erste Start dauert dadurch einige Minuten.
> Danach sind die Daten lokal vorhanden und der Start ist sofort.

### npm-Skripte
| Skript              | Wirkung                                                        |
|---------------------|----------------------------------------------------------------|
| `npm start`         | Server (HTTP + Routing-API) **und** interaktive Recherche-TUI  |
| `npm run scrape`    | lädt alle Layer neu vom WFS (`-- <layer>` für einen einzelnen) |
| `npm run build:data`| baut aus `data/raw/geo_*.json` die `data/web/map_*.geojson`    |
| `npm run typecheck` | TypeScript-Typprüfung (`tsc --noEmit`)                         |
| `npm run build`     | kompiliert nach `dist/`                                        |

## Projektstruktur

```
isr-streckennetz/
├── package.json · tsconfig.json      TypeScript-Projekt
├── Karte_starten.bat                 Ein-Klick-Start (Windows)
├── public/
│   └── index.html                    Leaflet-Karte (Frontend)
├── data/
│   ├── raw/                          Rohdaten: geo_*.json, *_meta.json, *.csv
│   └── web/                          web-optimierte map_*.geojson (vom Server ausgeliefert)
└── src/                              TypeScript-Quellen (eine Klasse je Datei, SOLID)
    ├── main.ts                       Composition Root (verdrahtet alles per DI)
    ├── config.ts · types.ts          Konfiguration, Typen + Abstraktionen (Interfaces)
    ├── core/    min-heap · graph · geo
    ├── data/    json-store · graph-builder · station-repository · search-index · isr-data
    ├── routing/ route-service
    ├── server/  http-server · api-router · static-file-handler
    └── tui/     tui-app · tui-renderer · input-handler · ansi
```

### Architektur (SOLID)
- **SRP** – jede Klasse hat genau eine Verantwortung (z. B. `GraphBuilder` baut nur den
  Graphen, `StationRepository` verwaltet nur Betriebsstellen, `TuiRenderer` rendert nur).
- **OCP** – neue Datenquellen für die Suche werden über `SOURCES` in `search-index.ts`
  ergänzt, neue Kartenlayer über `LAYERS` in `config.ts` – ohne Codeänderung an der Logik.
- **LSP/ISP** – schmale Interfaces (`Pathfinder`, `StationLookup`, `StationSuggester`,
  `EntitySearch`) in `types.ts`; Konsumenten sehen nur, was sie brauchen.
- **DIP** – `RouteService` hängt von `Pathfinder`+`StationLookup` (Abstraktionen) ab, nicht
  von `Graph`/`StationRepository`; `main.ts` injiziert die konkreten Implementierungen.

## Karte (public/index.html)
OpenStreetMap-Hintergrund, alle 19.884 Streckenabschnitte Canvas-gerendert. Umschaltbare
**Overlays** (Kontrollfeld rechts oben): Übergangsstellen, Betriebsstellen, Tunnel, Brücken,
Bahnübergänge – jeweils mit Klick-Popup. Einfärbung der Strecken nach Elektrifizierung /
Höchstgeschwindigkeit / Gleisanzahl, Streckennummer-Suche mit Zoom. Umlaute korrekt (`charset=utf-8`).

## Routenfindung
Zwei Betriebsstellen über ihren **RL100**-Code eingeben (mit Autocomplete) und die
**schnellste (Fahrzeit)** oder **kürzeste (Distanz)** Route berechnen. Die Route wird auf der
Karte gezeichnet, mit Gesamtdistanz, Fahrzeit, Ø-Geschwindigkeit und Betriebsstellen-Folge.

**Routing-Graph** (im Server): Knoten = Betriebsstellen (`STEL_ID`), Kanten =
Streckenabschnitte (`ISR_STEL_ID_VON` ↔ `ISR_STEL_ID_BIS`), bidirektional. Gewicht: `fast` =
Fahrzeit (`Länge / BET_GESCHWINDIGKEIT`), `short` = Länge. Fehlende Geschwindigkeit → 50 km/h,
fehlende Länge → aus Geometrie (Haversine). Netz: 11.156 Knoten, 19.884 Kanten, größte
zusammenhängende Komponente ≈ 95 %. Statt RL100 ist auch eine direkte `STEL_ID` möglich.

### HTTP-API
- `GET /api/route?from=<RL100>&to=<RL100>&mode=fast|short` → Route als JSON.
- `GET /api/stations?q=<text>` → Autocomplete (RL100 / Name).
- `GET /api/search?q=<text>` → Volltextsuche über alle Entitäten.
- `GET /data/<datei>.geojson` → Kartendaten; `GET /` → Karte.

## Recherche-TUI
`npm start` zeigt im Terminal eine interaktive Oberfläche: **Suchfeld** (Live-Filter über
27.375 Objekte: Betriebsstellen, Strecken, Tunnel, Brücken, Bahnübergänge), Ergebnisliste
(↑↓ wählen), Detailansicht (Enter). Bei Auswahl einer **Strecke** wird zusätzlich die
komplette **Liste ihrer Abschnitte** angezeigt (km von→bis, von–bis-Betriebsstellen, Länge,
Höchstgeschwindigkeit, Gleisanzahl) – nach Kilometer sortiert und mit ↑↓ scrollbar. Esc/Enter
zurück, Ctrl+C beendet. Läuft parallel zum Webserver (dieselben Daten). In nicht-interaktiven
Umgebungen wird die TUI automatisch deaktiviert und nur der Server gestartet.

## Rohdaten-Dateien (data/raw/)
- `streckenabschnitte.csv` / `_meta.json` — **Kerndatensatz**, alle 171 Attribute je Abschnitt.
- `streckenuebergaenge`, `betriebsstellen`, `strecken`, `tunnel`, `bruecken`,
  `bahnuebergaenge` — je `.csv` + `_meta.json` + `geo_*.json` (Geometrie, WGS84).
- `streckennummern.csv`, `strecken_uebersicht.{csv,json}` — abgeleitete Übersichten.

## Encoding-Hinweis
Alle Dateien sind **korrektes UTF-8** (CSV zusätzlich mit BOM für Excel). Erscheinen Umlaute
falsch (`Ã¼` statt `ü` oder `�`), interpretiert das öffnende Programm die Datei fälschlich als
Windows-1252 → im Editor auf UTF-8 umstellen. In der Leaflet-Karte werden Umlaute garantiert
korrekt angezeigt.

## Wichtige Felder (Streckenabschnitte)

**Identität / Lage**
- `ISR_STRE_NR` — Streckennummer
- `STRECKEN_ABSCHNITT` — Klartext-Beschreibung ("Str 1011 KM 0,6+0 bis 14,1+58 eingleisig")
- `ISR_STRECKE_VON_BIS` — Betriebsstellen von–bis ("Jübek, 07W9 - Ohrstedt")
- `ISR_KM_VON` / `ISR_KM_BIS` — km-Angabe im Format "km,dez + meter" (z. B. `0,6 + 0`)
- `ISR_KM_VON_I` / `ISR_KM_BIS_I` — km als Integer-Schlüssel (1 + KM*10000 + Meter)
- `ISR_STEL_ID_VON` / `ISR_STEL_ID_BIS` — Betriebsstellen-IDs
- `ALG_LAENGE_ABSCHNITT` — Abschnittslänge (km)

**Allgemein (ALG_)**: Infrastrukturbetreiber, IM-Code, Staat, TEN-Klassifizierung
(GV/PV, Person/Güter), Verkehrsart, LiRa-Profile (min/int/nat), KV-Profil,
Streckenklasse, RFC-Korridore (ATL/NSB/NSRM/RD/ScanMed).

**Infrastruktur (INF_)**: Gleisanzahl, Kommunikationssystem, Traktionsart
(elektrifiziert?), Neigetechnik, Streckenneigung, Steigungsprofil, Bogenradius,
Spurweite, Schienenneigung, Temperaturspanne, Höchsthöhe, HSLM u. v. m.

**Betrieb (BET_)**: Höchstgeschwindigkeit (`BET_GESCHWINDIGKEIT`, + Cluster),
Betriebsverfahren, Öffnungszeiten, Pufferzeiten, digitaler Befehl.

**Leit-/Sicherungstechnik (LST_)**: PZB, LZB, ETCS (Level/Version/Infill/National),
GSM-R (Version/Roaming/GPRS), Zugortung, Zugsicherungssysteme — ~90 Felder.

**Energie (ENE_)**: Maximalströme (Pz/Gz/Stillstand), Traktionsstromart,
Fahrdrahthöhen, Stromabnehmer-Anforderungen, Phasen-/Systemtrennstrecken.

**Kapazität (KAPAZITAETSBINDUNG_RV_*)**: Kapazitätsbindung in 2-h-Zeitscheiben (00–24 Uhr).

## Nutzungshinweise

- Die CSVs sind UTF-8 mit BOM (Excel-kompatibel, Umlaute korrekt).
- Für GIS: die `geo_*.json` sind Standard-GeoJSON (in QGIS direkt ladbar).
- Rechtliches: Daten stammen aus dem öffentlichen DB-Infrastrukturregister
  (DB InfraGO AG). Nutzung gemäß deren Bedingungen.
