'use client';

// Next.js Main Page.
// Verantwortung: Seitenaufbau, Formular-States und Datenkoordination (SRP).
// Implements TypeScript, React hooks, and premium dark theme design.

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically load MapComponent (SSR: false) because MaplibreGL uses browser WebGL
const MapComponent = dynamic(() => import('../components/map-component'), {
  ssr: false,
});

export default function Home() {
  // Page states
  const [colorMode, setColorMode] = useState('elektr');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTrigger, setSearchTrigger] = useState('');
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [routeMode, setRouteMode] = useState('fast');
  const [routeData, setRouteData] = useState<any>(null);
  
  // Data loading states
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Lade Daten...');
  const [isLoading, setIsLoading] = useState(true);
  const [linesData, setLinesData] = useState<any>(null);
  const [streckeninfoData, setStreckeninfoData] = useState<any>(null);
  const [liveTripsData, setLiveTripsData] = useState<any[]>([]);
  const [realtimeOnly, setRealtimeOnly] = useState(true);
  const [statusText, setStatusText] = useState('Lade Kartendaten...');
  const [siStatusText, setSiStatusText] = useState('Lade Streckenmeldungen...');
  const [ltStatusText, setLtStatusText] = useState('Lade Live-Züge...');
  const [version, setVersion] = useState('');

  // Autocomplete suggestions
  const [fromSuggestions, setFromSuggestions] = useState<any[]>([]);
  const [toSuggestions, setToSuggestions] = useState<any[]>([]);

  // Ref to track map bounds for live trips updates
  const mapBoundsRef = useRef<{ min: string; max: string; zoom: number } | null>(null);

  // 1. Fetch Version and Streckenabschnitte on load (with progress)
  useEffect(() => {
    // Get software version
    fetch('/api/version')
      .then((r) => r.json())
      .then((d) => setVersion(d.version || ''))
      .catch(() => {});

    // Fetch streckenabschnitte with streaming progress
    const loadLinesData = async () => {
      try {
        const resp = await fetch('/data/map_streckenabschnitte.geojson');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        
        const total = Number(resp.headers.get('Content-Length')) || 0;
        if (!resp.body || !total) {
          // Fallback if content-length is not supported
          const json = await resp.json();
          setLinesData(json);
          setIsLoading(false);
          setStatusText(`${json.features.length.toLocaleString('de-DE')} Abschnitte geladen`);
          return;
        }

        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            const progress = (received / total) * 100;
            setLoadingProgress(progress);
            setLoadingText(`Lade Kartendaten … ${Math.round(progress)} %`);
          }
        }

        const merged = new Uint8Array(received);
        let pos = 0;
        for (const c of chunks) {
          merged.set(c, pos);
          pos += c.length;
        }

        const json = JSON.parse(new TextDecoder().decode(merged));
        setLinesData(json);
        setIsLoading(false);
        setStatusText(`${json.features.length.toLocaleString('de-DE')} Abschnitte geladen`);
      } catch (err: any) {
        setStatusText(`Fehler beim Laden der Kartendaten: ${err.message}`);
        setIsLoading(false);
      }
    };

    void loadLinesData();
  }, []);

  // 2. Fetch Streckeninfo (Meldungen) and listen to SSE updates
  const fetchStreckeninfo = () => {
    fetch('/api/streckeninfo')
      .then((r) => r.json())
      .then((d) => {
        setStreckeninfoData(d);
        if (d.error) {
          setSiStatusText(`Streckeninfo: ${d.error}`);
        } else {
          const counts = d.counts || { stoerungen: 0, baustellen: 0, streckenruhen: 0 };
          setSiStatusText(
            `Streckeninfo: ${counts.stoerungen || 0} Störungen · ` +
            `${counts.baustellen || 0} Baustellen · ${counts.streckenruhen || 0} Streckenruhen`
          );
        }
      })
      .catch((e) => {
        setSiStatusText(`Streckeninfo nicht verfügbar (${e.message})`);
      });
  };

  useEffect(() => {
    fetchStreckeninfo();

    // SSE connection for live updates
    const events = new EventSource('/api/streckeninfo/events');
    events.addEventListener('streckeninfo', () => {
      fetchStreckeninfo();
    });

    // Fallback polling every 3 minutes (180,000 ms)
    const interval = setInterval(fetchStreckeninfo, 180000);

    return () => {
      events.close();
      clearInterval(interval);
    };
  }, []);

  // 3. Autocomplete station lookups
  useEffect(() => {
    if (fromQuery.trim().length < 1) {
      setFromSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/stations?q=${encodeURIComponent(fromQuery.trim())}`)
        .then((r) => r.json())
        .then((data) => setFromSuggestions(data || []))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [fromQuery]);

  useEffect(() => {
    if (toQuery.trim().length < 1) {
      setToSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/stations?q=${encodeURIComponent(toQuery.trim())}`)
        .then((r) => r.json())
        .then((data) => setToSuggestions(data || []))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [toQuery]);

  // 4. Fetch Live Train data on viewport changes (and every 30s)
  const fetchLiveTrips = async () => {
    // Can only fetch if map viewport bounds are captured
    const container = document.querySelector('.map-container');
    if (!container) return; // not rendered yet

    // We fetch bounds from the map in global state or via simulated map container boundaries
    // In MapComponent, we will hook map moveend events to update mapBoundsRef.
    const bounds = mapBoundsRef.current;
    if (!bounds || bounds.zoom < 3) {
      setLtStatusText('Live-Züge: Zum Anzeigen heranzoomen (ab Zoom 3)');
      setLiveTripsData([]);
      return;
    }

    try {
      const now = new Date();
      const end = new Date(now.getTime() + 30000);
      const url = `/api/trips?min=${bounds.min}&max=${bounds.max}&startTime=${now.toISOString()}&endTime=${end.toISOString()}&zoom=${bounds.zoom}`;
      
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      
      setLiveTripsData(data || []);
      const count = (data || []).filter((z: any) => !realtimeOnly || z.realTime).length;
      setLtStatusText(`Live-Züge: ${count} im Ausschnitt · Stand ${now.toLocaleTimeString('de-DE')}`);
    } catch (e: any) {
      setLtStatusText(`Live-Züge nicht verfügbar (${e.message})`);
    }
  };

  // Poll live trips every 30 seconds
  useEffect(() => {
    fetchLiveTrips();
    const interval = setInterval(fetchLiveTrips, 30000);
    return () => clearInterval(interval);
  }, [realtimeOnly]);

  // Handle map bounds updating from the Map Component
  useEffect(() => {
    const handleBoundsUpdate = () => {
      fetchLiveTrips();
    };
    window.addEventListener('map-bounds-changed', handleBoundsUpdate);
    return () => window.removeEventListener('map-bounds-changed', handleBoundsUpdate);
  }, [realtimeOnly]);

  // Setup global ref setter for MapComponent to push bounds changes
  useEffect(() => {
    (window as any).__setMapBounds = (min: string, max: string, zoom: number) => {
      mapBoundsRef.current = { min, max, zoom };
      window.dispatchEvent(new Event('map-bounds-changed'));
    };
    return () => {
      delete (window as any).__setMapBounds;
    };
  }, []);

  // 5. Actions
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSearchTrigger(searchQuery.trim());
    }
  };

  const handleCalculateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromQuery || !toQuery) {
      alert('Bitte Start und Ziel angeben (z.B. RL100-Code wie AH oder MH).');
      return;
    }

    try {
      setStatusText('Berechne Route …');
      const fromCode = fromQuery.split(' – ')[0] || fromQuery;
      const toCode = toQuery.split(' – ')[0] || toQuery;
      const res = await fetch(`/api/route?from=${encodeURIComponent(fromCode)}&to=${encodeURIComponent(toCode)}&mode=${routeMode}`);
      const data = await res.json();
      
      if (!data.ok) {
        setStatusText(`Routenfehler: ${data.error}`);
        setRouteData(null);
      } else {
        setRouteData(data);
        setStatusText(`Route berechnet: ${data.totalDistKm.toLocaleString('de-DE')} km.`);
      }
    } catch (e: any) {
      setStatusText(`Routenfehler: ${e.message}`);
      setRouteData(null);
    }
  };

  const handleClearRoute = () => {
    setRouteData(null);
    setFromQuery('');
    setToQuery('');
  };

  // Helper formatting values
  const formatTime = (timeMin: number) => {
    const h = Math.floor(timeMin / 60);
    const m = Math.round(timeMin % 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
  };

  const LEGEND_ITEMS: Record<string, [string, string][]> = {
    elektr: [
      ['#2f7fe0', 'Oberleitung'],
      ['#9b59d0', 'Stromschiene'],
      ['#e8863b', 'nicht elektrifiziert'],
      ['#8894a0', 'keine Angabe'],
    ],
    gleis: [
      ['#2f7fe0', 'Richtungsgleis'],
      ['#38b48b', 'Gegengleis'],
      ['#e8863b', 'eingleisig'],
      ['#8894a0', 'keine Angabe'],
    ],
    uniform: [
      ['#2f7fe0', 'Strecke'],
    ],
    speed: [
      ['#c0245e', '≥ 230 km/h'],
      ['#e34a6f', '160–229'],
      ['#f0883e', '120–159'],
      ['#e8c135', '100–119'],
      ['#7bbf4a', '80–99'],
      ['#3d9970', '< 80'],
      ['#8894a0', 'k. A.'],
    ],
  };

  return (
    <>
      {isLoading ? (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#0a0d14', zIndex: 100
        }}>
          <div style={{ width: '280px', textAlign: 'center' }}>
            <div className="progress-bar indet" style={{ height: '6px', marginBottom: '12px' }}>
              <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
            </div>
            <div style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 500 }}>{loadingText}</div>
          </div>
        </div>
      ) : (
        <MapComponent
          colorMode={colorMode}
          linesData={linesData}
          routeData={routeData}
          searchResult={searchTrigger}
          streckeninfoData={streckeninfoData}
          liveTripsData={liveTripsData}
          realtimeOnly={realtimeOnly}
          onStatusUpdate={setStatusText}
        />
      )}

      {version && <div id="version-tag" title="Software-Version">{version}</div>}

      <div className="panel" id="panel">
        <div className="panel-header">
          <div className="panel-title">🚆 ISR – Streckennetz</div>
        </div>
        <div className="panel-body">
          {/* Einfärbung */}
          <label>Einfärbung</label>
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value)}>
            <option value="elektr">Elektrifizierung</option>
            <option value="speed">Höchstgeschwindigkeit</option>
            <option value="gleis">Gleisanzahl</option>
            <option value="uniform">Einfarbig</option>
          </select>

          {/* Suche */}
          <label>Streckennummer suchen</label>
          <form onSubmit={handleSearch} className="row">
            <input
              type="text"
              inputMode="numeric"
              placeholder="z. B. 1011"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" style={{ flex: '0 0 64px' }}>Zoom</button>
          </form>

          {/* Routing */}
          <div id="routing">
            <label>Routenfindung (RL100)</label>
            <form onSubmit={handleCalculateRoute}>
              <input
                type="text"
                placeholder="Start – z. B. AH (Hamburg Hbf)"
                value={fromQuery}
                onChange={(e) => setFromQuery(e.target.value)}
                list="fromList"
                autoComplete="off"
              />
              <datalist id="fromList">
                {fromSuggestions.map((s) => (
                  <option key={s.rl100} value={`${s.rl100} – ${s.name}`} />
                ))}
              </datalist>

              <input
                type="text"
                placeholder="Ziel – z. B. MH (München Hbf)"
                value={toQuery}
                onChange={(e) => setToQuery(e.target.value)}
                list="toList"
                autoComplete="off"
                style={{ marginTop: '6px' }}
              />
              <datalist id="toList">
                {toSuggestions.map((s) => (
                  <option key={s.rl100} value={`${s.rl100} – ${s.name}`} />
                ))}
              </datalist>

              <div className="row" style={{ marginTop: '6px' }}>
                <select value={routeMode} onChange={(e) => setRouteMode(e.target.value)}>
                  <option value="fast">schnellste (Zeit)</option>
                  <option value="short">kürzeste (Distanz)</option>
                </select>
                <button type="submit" className="btn btn-ok" style={{ flex: '0 0 84px' }}>Route</button>
              </div>
            </form>

            {routeData && (
              <button onClick={handleClearRoute} className="btn btn-ghost" style={{ width: '100%', marginTop: '6px', fontSize: '11px' }}>
                Route löschen
              </button>
            )}

            {routeData && (
              <div id="rResult">
                <div className="route-summary">
                  {routeData.mode === 'short' ? 'Kürzeste' : 'Schnellste'} Route<br />
                  <b>{routeData.totalDistKm.toLocaleString('de-DE')} km</b> · <b>{formatTime(routeData.totalTimeMin)}</b><br />
                  <span style={{ color: 'var(--txt-muted)', fontSize: '11px' }}>
                    {routeData.nWaypoints} Betriebsstellen · {routeData.nEdges} Abschnitte
                  </span>
                </div>
                <div className="route-waypoints">
                  {routeData.waypoints.map((w: any, idx: number) => (
                    <div key={idx} className="route-waypoint">
                      <span className="rl">{w.rl100 || '—'}</span> {w.name || `STEL ${w.stel}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div id="legend">
            {LEGEND_ITEMS[colorMode]?.map(([color, label]) => (
              <div key={label} className="item">
                <span className="swatch" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>

          {/* Live Train Filters */}
          <div style={{ marginTop: '16px', borderTop: '1px solid var(--panel-border)', paddingTop: '12px' }}>
            <label style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', textTransform: 'none' }}>
              <input 
                type="checkbox" 
                checked={realtimeOnly} 
                onChange={(e) => setRealtimeOnly(e.target.checked)} 
                style={{ width: 'auto' }}
              />
              Nur Echtzeit-Züge anzeigen
            </label>
          </div>

          {/* Status Section */}
          <div id="status-area">
            <div className="status-text" style={{ fontWeight: 500 }}>{statusText}</div>
            <div className="status-text">{siStatusText}</div>
            <div className="status-text">{ltStatusText}</div>
          </div>

          {/* Sammelmeldungen */}
          {streckeninfoData?.sammelmeldungen && streckeninfoData.sammelmeldungen.length > 0 && (
            <div className="sammelmeldung-box">
              <details open>
                <summary>Sammelmeldungen ({streckeninfoData.sammelmeldungen.length})</summary>
                <div style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '8px' }}>
                  {streckeninfoData.sammelmeldungen.map((s: any, idx: number) => (
                    <div key={idx} className="sammelmeldung-item">
                      <div className="sammelmeldung-cause">{s.cause || 'Sammelmeldung'}</div>
                      {s.text && <div className="sammelmeldung-text">{s.text}</div>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
