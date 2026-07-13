'use client';

// Floating departures panel (bottom right of the map): next departures at a
// station / operating point via /api/departures (Transitous stoptimes, server-
// cached, spatially resolved around the ISR coordinate). Opened from the
// operating-point popup or via its own station search field (datalist
// autocomplete over /api/stations, as in RoutingForm). All visible text is
// German.
import { useEffect, useRef, useState } from 'react';
import { getDepartures, getStations } from '@/lib/api';
import { fmtTimeHM } from '@/lib/format';
import type { DeparturesResult, DeparturesStation, StationSuggestion } from '@/lib/types';
import { CATEGORY_COLOR, CATEGORY_COLOR_FALLBACK, type TrainCategory } from '@shared/live-trips-core';

/** Autocomplete delay as in RoutingForm. */
const AUTOCOMPLETE_DEBOUNCE_MS = 150;
/** Refresh cadence while the panel is open (the server caches 30 s per station). */
const REFRESH_MS = 60_000;

/** Category color of a departure (same palette as the live-train markers). */
function categoryColor(category: TrainCategory): string {
  return category === 'other' ? CATEGORY_COLOR_FALLBACK : CATEGORY_COLOR[category];
}

/** Datalist caption of a suggestion, e.g. "AH – Hamburg Hbf". */
function suggestionLabel(v: StationSuggestion): string {
  return v.rl100 ? `${v.rl100} – ${v.name}` : v.name;
}

interface DeparturesPanelProps {
  /** Station to show departures for (null = nothing selected yet). */
  station: DeparturesStation | null;
  onSelectStation: (station: DeparturesStation) => void;
  onClose: () => void;
}

export default function DeparturesPanel({ station, onSelectStation, onClose }: DeparturesPanelProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [result, setResult] = useState<DeparturesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (acTimer.current) clearTimeout(acTimer.current); }, []);

  // Load immediately on station change, then refresh while the panel is open.
  useEffect(() => {
    if (!station) return;
    let stale = false;
    const load = (): void => {
      setLoading(true);
      getDepartures(station.lat, station.lon)
        .then((r) => { if (!stale) setResult(r); })
        .catch((e: unknown) => {
          if (stale) return;
          setResult({
            stationName: '', departures: [], generatedAt: '',
            error: e instanceof Error ? e.message : String(e),
          });
        })
        .finally(() => { if (!stale) setLoading(false); });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { stale = true; clearInterval(timer); };
  }, [station]);

  // Search field: debounced autocomplete; an exact datalist pick selects the station.
  const handleQuery = (value: string): void => {
    setQuery(value);
    const picked = suggestions.find((v) => suggestionLabel(v) === value);
    if (picked && picked.lat != null && picked.lon != null) {
      onSelectStation({ name: picked.name, lat: picked.lat, lon: picked.lon });
      setQuery('');
      return;
    }
    if (acTimer.current) clearTimeout(acTimer.current);
    const q = value.trim();
    if (!q) return;
    acTimer.current = setTimeout(() => {
      getStations(q)
        .then((all) => setSuggestions(all.filter((v) => v.lat != null && v.lon != null)))
        .catch(() => { /* suggestions are optional */ });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const title = station ? `Abfahrten · ${result?.stationName || station.name}` : 'Abfahrten';
  const generatedMs = result ? Date.parse(result.generatedAt) : NaN;

  return (
    <div className="departures">
      <div className="departures-head">
        <span className="departures-title" title={title}>{title}</span>
        <button type="button" className="departures-close" aria-label="Schließen" onClick={onClose}>✕</button>
      </div>
      <div className="departures-search">
        <input
          list="depStations" placeholder="Bahnhof / Betriebsstelle suchen …" autoComplete="off"
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
        />
        <datalist id="depStations">
          {suggestions.map((v) => (
            <option key={v.stel} value={suggestionLabel(v)} />
          ))}
        </datalist>
      </div>
      <div className="departures-body">
        {!station ? (
          <div className="hint">
            Betriebsstelle auf der Karte anklicken („Nächste Abfahrten“) oder oben suchen.
          </div>
        ) : null}
        {station && result ? (
          <>
            {result.error ? <div className="status-line err">Abfahrten nicht verfügbar ({result.error})</div> : null}
            {!result.error && result.departures.length === 0 ? (
              <div className="status-line">Keine Zug-Abfahrten gefunden.</div>
            ) : null}
            {result.departures.map((d, i) => {
              const track = d.track ?? d.scheduledTrack;
              return (
                <div key={`${d.tripId}-${d.departMs}-${i}`} className={d.cancelled ? 'dep-row dep-cancelled' : 'dep-row'}>
                  <div className="dep-line1">
                    <span className="dep-time">{fmtTimeHM(d.departMs)}</span>
                    {d.delayMin > 0 ? <span className="dep-delay">+{d.delayMin}</span> : null}
                    <span className="dep-name">
                      <span className="dep-dot" style={{ background: categoryColor(d.category) }} />
                      {d.name}
                    </span>
                    {d.cancelled ? (
                      <span className="dep-cancelled-note">fällt aus</span>
                    ) : track ? (
                      <span className="dep-track">Gl. {track}</span>
                    ) : null}
                  </div>
                  <div className="dep-dest">→ {d.headsign || '?'}</div>
                </div>
              );
            })}
            {Number.isFinite(generatedMs) ? (
              <div className="status-line">
                Stand {fmtTimeHM(generatedMs)}{loading ? ' · aktualisiere …' : ''}
              </div>
            ) : null}
          </>
        ) : null}
        {station && !result ? <div className="status-line">Lade Abfahrten …</div> : null}
      </div>
    </div>
  );
}
