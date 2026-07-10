'use client';

// Route finding (RL100): two inputs with datalist autocomplete via /api/stations
// (debounced), mode selection, and result display (summary + waypoint list).
// Drawing/clearing the route on the map is the RouteLayer's job via the
// onRoute/onClear callbacks (SRP: only form + result display here).
import { useEffect, useRef, useState } from 'react';
import { getRoute, getStations } from '@/lib/api';
import type { RouteMode, RouteResult, StationSuggestion } from '@/lib/types';

/** Autocomplete delay as in the old frontend. */
const AUTOCOMPLETE_DEBOUNCE_MS = 150;

/** Readable total time: "2 h 5 min" or "45 min". */
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

interface RoutingFormProps {
  onRoute: (route: RouteResult) => void;
  onClear: () => void;
}

export default function RoutingForm({ onRoute, onClear }: RoutingFormProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<RouteMode>('fast');
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (acTimer.current) clearTimeout(acTimer.current); }, []);

  // Both inputs share one datalist (as in the old frontend).
  const autocomplete = (value: string): void => {
    if (acTimer.current) clearTimeout(acTimer.current);
    const q = value.trim();
    if (!q) return;
    acTimer.current = setTimeout(() => {
      getStations(q).then(setSuggestions).catch(() => { /* suggestions are optional */ });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const clearRoute = (): void => {
    onClear();
    setResult(null);
    setError('');
  };

  const calculateRoute = async (): Promise<void> => {
    const fromCode = from.trim();
    const toCode = to.trim();
    if (!fromCode || !toCode) {
      setResult(null);
      setError('Start und Ziel angeben.');
      return;
    }
    clearRoute();
    setLoading(true);
    try {
      const d = await getRoute(fromCode, toCode, mode);
      if (!d.ok) {
        setError(d.error);
        return;
      }
      setResult(d);
      onRoute(d);
    } catch (e) {
      setError(`Fehler: ${e instanceof Error ? e.message : String(e)}. Läuft der Server (npm start)?`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="routing">
      <label htmlFor="rFrom">Routenfindung (RL100)</label>
      <input
        id="rFrom" list="rlList" placeholder="Start – z. B. AH (Hamburg Hbf)" autoComplete="off"
        value={from}
        onChange={(e) => { setFrom(e.target.value); autocomplete(e.target.value); }}
      />
      <input
        id="rTo" list="rlList" placeholder="Ziel – z. B. MH (München Hbf)" autoComplete="off"
        style={{ marginTop: 6 }}
        value={to}
        onChange={(e) => { setTo(e.target.value); autocomplete(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void calculateRoute(); }}
      />
      <datalist id="rlList">
        {suggestions.map((v) => (
          <option key={v.stel} value={v.rl100 ?? ''}>{`${v.rl100 ?? ''} – ${v.name}`}</option>
        ))}
      </datalist>
      <div className="row" style={{ marginTop: 6 }}>
        <select id="rMode" value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
          <option value="fast">schnellste (Zeit)</option>
          <option value="short">kürzeste (Distanz)</option>
        </select>
        <button type="button" className="btn btn-ok" style={{ flex: '0 0 84px' }} onClick={() => void calculateRoute()}>
          Route
        </button>
      </div>
      <button
        type="button" className="btn btn-ghost"
        style={{ width: '100%', marginTop: 6, fontSize: 11 }}
        onClick={clearRoute}
      >
        Route löschen
      </button>
      <div className="route-result">
        {loading ? 'Berechne Route …' : null}
        {error ? <div className="err">{error}</div> : null}
        {result ? (
          <>
            <div className="summary">
              {result.mode === 'short' ? 'kürzeste' : 'schnellste'} Route<br />
              <b>{result.totalDistKm.toLocaleString('de-DE')} km</b> · <b>{formatDuration(result.totalTimeMin)}</b><br />
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                {result.nWaypoints} Betriebsstellen · {result.nEdges} Abschnitte
                {' · ⌀ '}{(result.totalDistKm / (result.totalTimeMin / 60)).toFixed(0)} km/h
              </span>
            </div>
            <div className="wp">
              {result.waypoints.map((w, i) => (
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
