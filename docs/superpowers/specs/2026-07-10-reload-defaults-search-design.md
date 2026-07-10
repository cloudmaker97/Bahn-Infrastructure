# Design: 12-h-Daten-Refresh, Default „Einfarbig", erweiterte Kartensuche

Datum: 2026-07-10 · Status: umgesetzt (autonomer Hintergrund-Job, Annahmen im PR dokumentiert)

## Anforderungen

1. ISR-Daten alle 12 Stunden automatisch neu laden.
2. Streckenlayer startet in der Einfärbung „Einfarbig" statt „Elektrifizierung".
3. Die Kartensuche findet neben Streckennummern auch Live-Zugnummern und
   RL100-Betriebsstellen.

## 1. Automatischer Daten-Refresh (Server)

- `config.ts`: `DATA_REFRESH_INTERVAL_MS` – Default 12 h, per `DATA_REFRESH_HOURS`
  übersteuerbar, `0`/ungültig deaktiviert den Zeitplan.
- `main.ts`: Der bestehende `refreshData()`-Pfad (scrapeAll → buildMapData →
  `ReloadableIsrData.reload()` → Cache-Invalidierung) wird in einen `SingleFlight`
  gelegt: Timer und TUI-Ctrl+R teilen sich einen laufenden Refresh statt doppelt
  zu scrapen. Ein `setInterval` (unref'd) stößt den Refresh an; Fehler werden nur
  gemeldet (alte Daten bleiben aktiv), nächster Versuch nach Intervall.
- Meldungsweg: headless → `console.log`; TUI-Modus → neue `TuiApp.notify()`
  (console würde den TUI-Screen zerstören).

## 2. Default „Einfarbig" (Web)

- `MapApp.tsx`: initialer `colorMode`-State `'uniform'`.
- `rail-network.ts`: initialer Layer-Mode `'uniform'` (damit der erste Paint vor
  dem React-Effekt schon stimmt).

## 3. Erweiterte Suche (Web)

Neues Modul `web/src/map/search.ts` (`MapSearch`) orchestriert die Auflösung in
fester Reihenfolge – die Ergebnisarten überlappen praktisch nicht (Strecken
numerisch, RL100 alphabetisch, Züge nur bei vollständigem Namen/Zugnummer):

1. **Strecke**: bestehende `RailNetworkLayer.search()` (Highlight + fitBounds).
2. **RL100**: exakter Code-Match über `/api/stations` → flyTo + Popup
   (Name + RL100). Kein Namens-Fuzzy – bewusst nur exakte Codes.
3. **Live-Zug**: `matchesTrainQuery()` (shared, selftest-gedeckt) über die
   geladenen Live-Züge; Treffer = vollständiger Name („ICE 577", auch „ice577")
   oder komplette Zugnummer am Namensende („577", nicht „ICE 1577"). Respektiert
   den „Nur Echtzeit"-Filter (Suche findet genau das, was die Karte zeigt);
   fitBounds über die aktuellen interpolierten Positionen (maxZoom 11).
4. Kein Treffer → Statuszeile „… nicht gefunden (Strecke, RL100 oder Live-Zug)".

Bei RL100-/Zug-Treffern wird das Strecken-Highlight gelöscht (`clearHighlight()`),
damit kein veralteter roter Layer stehen bleibt. `SearchForm` verliert
`inputMode="numeric"`; Label/Placeholder nennen alle drei Arten.

## Nicht-Ziele

- Keine Suche nach Betriebsstellen-Namen (nur exakte RL100-Codes, wie gefordert).
- Kein Verfolgen/Highlighten einzelner Züge (Positionen wandern; nur Zoom+Status).
