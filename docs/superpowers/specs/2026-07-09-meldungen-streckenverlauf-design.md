# Meldungen entlang des Streckenverlaufs statt Luftlinie

Datum: 2026-07-09 · Status: umgesetzt in diesem Branch

## Problem

Störungen und Baustellen aus strecken-info.de werden auf der Karte teilweise als
**Luftlinie** zwischen zwei Betriebsstellen gezeichnet statt entlang des realen
Gleisverlaufs (wie es die Routenfindung tut). Messung an echten Rohdaten
(2026-07-09, Revision 3311269):

- **Störungen** (58 aktiv, ohne Sammelmeldungen): 23 haben keine `koordinaten`
  und werden über `abschnitte` (RIL100-Paare) verortet → heute gerade Segmente
  `[von, bis]` = Luftlinie. Die `abschnitte` enthalten oft Hin- UND Rückrichtung
  (z. B. EEK→EBLB und EBLB→EEK) → doppelte Segmente.
- **Baustellen** (2145 aktiv): 1129 haben `koordinaten.von ≠ bis` → heute eine
  2-Punkt-Luftlinie; alle 1129 tragen beide RIL100 (`ril100Von`/`ril100Bis`).
- Direkte 2-Punkt-`koordinaten` der Störungen sind fast immer degenerierte
  Mini-Segmente (Meter-Bereich), keine langen Luftlinien → kein Handlungsbedarf.

## Lösung (serverseitig, im GeoJSON-Bau)

Der Server kennt den Routing-Graphen (Streckenabschnitte mit echter Geometrie).
Zwischen den beiden Betriebsstellen einer Meldung wird der Streckenverlauf per
Dijkstra bestimmt und dessen Polyline statt der Luftlinie geliefert. Das
Frontend bleibt unverändert (es zeichnet die gelieferte Geometrie).

### Komponenten

1. **`Graph.dijkstra(start, goal, mode, edgeFilter?)`** (`src/core/graph.ts`):
   optionaler Kantenfilter als kompatible Erweiterung der `Pathfinder`-
   Abstraktion. Ermöglicht die auf eine Streckennummer beschränkte Suche.

2. **`VerlaufResolver`** (`src/routing/verlauf-resolver.ts`, neu):
   `resolve(vonRil100, bisRil100, streckennummern?) → [lon,lat][] | null`
   - RIL100 → stel über `StationLookup`; Bahnhofsteil-Codes (Leerzeichen-Suffix,
     z. B. „TU  P") fehlen in der ISR-Stationsliste und fallen auf die
     Basis-Betriebsstelle („TU") zurück (leicht versetzter Endpunkt, aber realer
     Verlauf – betraf in der Messung 181 von ~1130 Baustellen-Paaren).
   - Suchreihenfolge: (a) Dijkstra `short`, beschränkt auf die gemeldeten
     Streckennummern; (b) unbeschränkt, aber mit **Umweg-Guard**
     (Pfadlänge ≤ max(3 × Luftlinie, Luftlinie + 30 km)), damit bei
     Graph-Lücken kein wilder Umweg als „gestörter Abschnitt" erscheint;
     (c) sonst `null` → Aufrufer behält die Luftlinie (heutiges Verhalten).
   - Kanten-`coords` ([lat,lon], Leaflet-Konvention) werden zu einer
     [lon,lat]-Kette (GeoJSON) verbunden, Stoßpunkte dedupliziert,
     Koordinaten auf 5 Nachkommastellen gerundet und per Douglas-Peucker
     (15 m Toleranz) vereinfacht – `/api/streckeninfo` wird alle 3 min
     gepollt, die Overlay-Linien brauchen keine Gleis-Präzision.
   - **Memo-Cache** je (von|bis|strecken); symmetrisch: (B,A) liefert die
     umgekehrte Kette von (A,B). `leereCache()` für den Daten-Reload.

3. **`streckeninfo.ts`**:
   - `baueGeoJson(rohdaten, now, resolveCoord, resolveVerlauf?)` – der neue
     Parameter ist optional; ohne ihn bleibt alles wie heute (reine Funktion,
     offline testbar).
   - `stoerungGeometry`: im `abschnitte`-Fallback je Abschnitt zuerst
     `resolveVerlauf(von, bis, [streckennummer])`, sonst Luftlinie.
     Richtungs-Duplikate (A→B + B→A, gleiche Strecke) werden dedupliziert.
   - `toBaustelleFeature`: bei `von ≠ bis` und beiden RIL100 zuerst
     `resolveVerlauf(ril100Von, ril100Bis, streckennummern)`, sonst Luftlinie.
   - `StreckenInfoService` erhält den Resolver optional über `opts.verlauf`.

4. **`main.ts`** (Composition Root): Resolver aus `data.pathfinder` +
   `data.stations` bauen, an den `StreckenInfoService` geben;
   `leereCache()` in `refreshData()` nach `data.reload()`.

### Verworfene Alternativen

- **Frontend-seitig routen** (wie die Streckenruhen-Linien aus dem
  Abschnitts-Index): müsste den Routing-Graphen im Browser nachbauen oder je
  Meldung `/api/route` aufrufen (1000+ Requests). Serverseitig ist der Graph
  schon da, und alle Clients (Web, TUI-Zähler, Cache) profitieren.
- **Nur `abschnitte` über den Abschnitts-Index der Strecke zeichnen**: deckt
  Baustellen nicht ab, deren von/bis mehrere Abschnitte überspannen, und
  braucht trotzdem eine Pfadsuche zwischen den Betriebsstellen.

### Performance

~23 Störungs-Abschnitte + ~1100 Baustellen-Paare je Refresh (TTL 3 min).
Die streckenbeschränkte Suche expandiert nur Knoten der jeweiligen Strecke
(< 1 ms); der Memo-Cache fängt Wiederholungen über Refreshes ab. Gemessen wird
im Live-Smoke des Selftests.

### Tests

- `graph`: Kantenfilter beschränkt die Suche; ohne Filter unverändert.
- `verlauf-resolver` (Fake-Graph/-Stations): folgt der Geometrie, bevorzugt die
  gemeldete Strecke, Umweg-Guard greift, `null` bei Unauflösbarem, Cache
  symmetrisch.
- `streckeninfo`: Abschnitts-Störung erhält Polyline (> 2 Punkte), Fallback
  Luftlinie ohne/bei scheiterndem Resolver (bestehende Asserts), Duplikat-
  Dedupe, Baustelle von≠bis erhält Polyline, von==bis bleibt Punkt.
- Live-Smoke: echte Daten + echter Graph, Anteil gerouteter Geometrien + Dauer.
