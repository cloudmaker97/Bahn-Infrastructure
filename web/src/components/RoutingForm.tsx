'use client';

// Routenfindung (RL100): zwei Eingaben mit datalist-Autocomplete über /api/stations
// (debounced), Modus-Wahl und Ergebnisdarstellung (Summary + Wegpunktliste).
// Das Zeichnen/Löschen der Route auf der Karte übernimmt der RouteLayer über die
// onRoute-/onClear-Callbacks (SRP: hier nur Formular + Ergebnis-Anzeige).
import { useEffect, useRef, useState } from 'react';
import { getRoute, getStations } from '@/lib/api';
import type { RouteMode, RouteResult, StationSuggestion } from '@/lib/types';

/** Autocomplete-Verzögerung wie im Alt-Frontend. */
const AUTOCOMPLETE_DEBOUNCE_MS = 150;

/** Gesamtzeit lesbar: „2 h 5 min" bzw. „45 min". */
function zeitText(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

interface RoutingFormProps {
  onRoute: (route: RouteResult) => void;
  onClear: () => void;
}

export default function RoutingForm({ onRoute, onClear }: RoutingFormProps) {
  const [von, setVon] = useState('');
  const [nach, setNach] = useState('');
  const [modus, setModus] = useState<RouteMode>('fast');
  const [vorschlaege, setVorschlaege] = useState<StationSuggestion[]>([]);
  const [ergebnis, setErgebnis] = useState<RouteResult | null>(null);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (acTimer.current) clearTimeout(acTimer.current); }, []);

  // Beide Eingaben teilen sich eine datalist (wie im Alt-Frontend).
  const autocomplete = (wert: string): void => {
    if (acTimer.current) clearTimeout(acTimer.current);
    const q = wert.trim();
    if (!q) return;
    acTimer.current = setTimeout(() => {
      getStations(q).then(setVorschlaege).catch(() => { /* Vorschläge sind optional */ });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const loeschen = (): void => {
    onClear();
    setErgebnis(null);
    setFehler('');
  };

  const berechnen = async (): Promise<void> => {
    const from = von.trim();
    const to = nach.trim();
    if (!from || !to) {
      setErgebnis(null);
      setFehler('Start und Ziel angeben.');
      return;
    }
    loeschen();
    setLaeuft(true);
    try {
      const d = await getRoute(from, to, modus);
      if (!d.ok) {
        setFehler(d.error);
        return;
      }
      setErgebnis(d);
      onRoute(d);
    } catch (e) {
      setFehler(`Fehler: ${e instanceof Error ? e.message : String(e)}. Läuft der Server (node isr-server.js)?`);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="routing">
      <label htmlFor="rFrom">Routenfindung (RL100)</label>
      <input
        id="rFrom" list="rlList" placeholder="Start – z. B. AH (Hamburg Hbf)" autoComplete="off"
        value={von}
        onChange={(e) => { setVon(e.target.value); autocomplete(e.target.value); }}
      />
      <input
        id="rTo" list="rlList" placeholder="Ziel – z. B. MH (München Hbf)" autoComplete="off"
        style={{ marginTop: 6 }}
        value={nach}
        onChange={(e) => { setNach(e.target.value); autocomplete(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void berechnen(); }}
      />
      <datalist id="rlList">
        {vorschlaege.map((v) => (
          <option key={v.stel} value={v.rl100 ?? ''}>{`${v.rl100 ?? ''} – ${v.name}`}</option>
        ))}
      </datalist>
      <div className="row" style={{ marginTop: 6 }}>
        <select id="rMode" value={modus} onChange={(e) => setModus(e.target.value as RouteMode)}>
          <option value="fast">schnellste (Zeit)</option>
          <option value="short">kürzeste (Distanz)</option>
        </select>
        <button type="button" className="btn btn-ok" style={{ flex: '0 0 84px' }} onClick={() => void berechnen()}>
          Route
        </button>
      </div>
      <button
        type="button" className="btn btn-ghost"
        style={{ width: '100%', marginTop: 6, fontSize: 11 }}
        onClick={loeschen}
      >
        Route löschen
      </button>
      <div className="route-result">
        {laeuft ? 'Berechne Route …' : null}
        {fehler ? <div className="err">{fehler}</div> : null}
        {ergebnis ? (
          <>
            <div className="summary">
              {ergebnis.mode === 'short' ? 'kürzeste' : 'schnellste'} Route<br />
              <b>{ergebnis.totalDistKm.toLocaleString('de-DE')} km</b> · <b>{zeitText(ergebnis.totalTimeMin)}</b><br />
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                {ergebnis.nWaypoints} Betriebsstellen · {ergebnis.nEdges} Abschnitte
                {' · ⌀ '}{(ergebnis.totalDistKm / (ergebnis.totalTimeMin / 60)).toFixed(0)} km/h
              </span>
            </div>
            <div className="wp">
              {ergebnis.waypoints.map((w, i) => (
                <div key={`${w.stel}-${i}`}>
                  <span className="rl">{w.rl100 || '—'}</span> {w.name || `STEL ${w.stel}`}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
