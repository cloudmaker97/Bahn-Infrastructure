'use client';

// MaplibreGL Map Component.
// Verantwortung: Kartenvisualisierung und Interaktion (SRP).
// Implements TypeScript, DRY principles, and advanced rendering.

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CATEGORY_COLOR, positionAt } from '../utils/live-trips-utils';

interface MapComponentProps {
  colorMode: string;
  linesData: any;
  routeData: any;
  searchResult: any; // zoom to matching strecke
  streckeninfoData: any;
  liveTripsData: any;
  realtimeOnly: boolean;
  onStatusUpdate: (msg: string) => void;
}

export default function MapComponent({
  colorMode,
  linesData,
  routeData,
  searchResult,
  streckeninfoData,
  liveTripsData,
  realtimeOnly,
  onStatusUpdate,
}: MapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Keep live trips state for 5fps interpolation animation
  const tripsRef = useRef<any[]>([]);
  const tripMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Use CartoDB Dark Matter vector style for a premium dark mode look
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [10.4, 51.2],
      zoom: 6,
    });

    mapRef.current = map;

    const updateBounds = () => {
      const b = map.getBounds();
      const min = `${b.getSouth()},${b.getWest()}`;
      const max = `${b.getNorth()},${b.getEast()}`;
      const zoom = map.getZoom();
      if ((window as any).__setMapBounds) {
        (window as any).__setMapBounds(min, max, zoom);
      }
    };

    map.on('load', () => {
      setMapLoaded(true);
      onStatusUpdate('Karte geladen. Initialisiere Overlays...');
      updateBounds();
    });

    map.on('moveend', updateBounds);
    map.on('zoomend', updateBounds);

    map.on('error', (err) => {
      console.error('Maplibre error:', err);
      // Fallback style in case CartoDB is unavailable
      map.setStyle({
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
          },
        ],
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Add Infrastructure Data Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !linesData) return;

    // If source already exists, don't recreate it
    if (map.getSource('streckenabschnitte')) return;

    // Streckenabschnitte Source & Layer
    map.addSource('streckenabschnitte', {
      type: 'geojson',
      data: linesData,
    });

    map.addLayer({
      id: 'streckenabschnitte',
      type: 'line',
      source: 'streckenabschnitte',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-width': 2.2,
        'line-opacity': 0.9,
        'line-color': '#2f7fe0', // default uniform color
      },
    });

    // Register other overlays asynchronously from /data/
    const addOverlayLayer = async (key: string, type: 'line' | 'circle', color: string, radius?: number) => {
      try {
        const res = await fetch(`/data/map_${key}.geojson`);
        if (!res.ok) return;
        const gj = await res.json();
        
        map.addSource(key, { type: 'geojson', data: gj });
        if (type === 'circle') {
          map.addLayer({
            id: key,
            type: 'circle',
            source: key,
            paint: {
              'circle-radius': radius || 3,
              'circle-color': color,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#111111',
              'circle-opacity': 0.9,
            },
          });
        } else {
          map.addLayer({
            id: key,
            type: 'line',
            source: key,
            paint: {
              'line-width': 4,
              'line-color': color,
              'line-opacity': 0.9,
            },
          });
        }
      } catch (e) {
        console.error(`Failed to load overlay ${key}:`, e);
      }
    };

    void addOverlayLayer('streckenuebergaenge', 'circle', '#ffd23f', 3.5);
    void addOverlayLayer('betriebsstellen', 'circle', '#4aa3ff', 3);
    void addOverlayLayer('tunnel', 'line', '#b06be8');
    void addOverlayLayer('bruecken', 'line', '#2ec76b');
    void addOverlayLayer('bahnuebergaenge', 'circle', '#ff7043', 2.5);

    // Setup hover and click popups
    setupPopups(map);
  }, [mapLoaded, linesData]);

  // 3. Dynamic Coloring based on colorMode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer('streckenabschnitte')) return;

    let colorExpression: any = '#2f7fe0'; // Default Uniform

    if (colorMode === 'elektr') {
      colorExpression = [
        'match',
        ['get', 'INF_TRAKTIONSART'],
        'Oberleitung', '#2f7fe0',
        'Stromschiene', '#9b59d0',
        'nicht elektrifiziert', '#e8863b',
        '#8894a0', // default gray
      ];
    } else if (colorMode === 'gleis') {
      colorExpression = [
        'match',
        ['get', 'INF_GLEISANZAHL'],
        'Richtungsgleis', '#2f7fe0',
        'Gegengleis', '#38b48b',
        'eingleisig', '#e8863b',
        '#8894a0',
      ];
    } else if (colorMode === 'speed') {
      // Höchstgeschwindigkeit
      colorExpression = [
        'let',
        'speed',
        ['to-number', ['get', 'BET_GESCHWINDIGKEIT'], -1],
        [
          'case',
          ['>=', ['var', 'speed'], 230], '#c0245e',
          ['>=', ['var', 'speed'], 160], '#e34a6f',
          ['>=', ['var', 'speed'], 120], '#f0883e',
          ['>=', ['var', 'speed'], 100], '#e8c135',
          ['>=', ['var', 'speed'], 80], '#7bbf4a',
          ['>=', ['var', 'speed'], 0], '#3d9970',
          '#8894a0', // default
        ],
      ];
    }

    map.setPaintProperty('streckenabschnitte', 'line-color', colorExpression);
  }, [colorMode, mapLoaded]);

  // 4. Update Streckeninfo (Störungen, Baustellen, Streckenruhen)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !streckeninfoData) return;

    const categories = [
      { key: 'stoerungen', color: '#d23f3f', type: 'circle' },
      { key: 'baustellen', color: '#f0883e', type: 'line' },
      { key: 'streckenruhen', color: '#8e44ad', type: 'circle' },
    ];

    categories.forEach(({ key, color, type }) => {
      const sourceName = `si-${key}`;
      const layerName = `si-${key}`;
      const fc = streckeninfoData[key] || { type: 'FeatureCollection', features: [] };

      const existingSource = map.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(fc);
      } else {
        map.addSource(sourceName, { type: 'geojson', data: fc });
        if (type === 'circle') {
          map.addLayer({
            id: layerName,
            type: 'circle',
            source: sourceName,
            paint: {
              'circle-radius': [
                'case',
                ['==', ['get', 'gleisEinschraenkung'], 'SCHWER'], 8,
                6
              ],
              'circle-color': color,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.9,
            },
          });
        } else {
          map.addLayer({
            id: layerName,
            type: 'line',
            source: sourceName,
            paint: {
              'line-width': [
                'case',
                ['==', ['get', 'gleisEinschraenkung'], 'SCHWER'], 6,
                4
              ],
              'line-color': color,
              'line-opacity': 0.9,
            },
          });
        }
      }
    });

    // Custom Streckenruhen lines
    if (streckeninfoData.streckenruhen && linesData) {
      const ruhenFeatures: any[] = [];
      const ruhenPoints = streckeninfoData.streckenruhen.features || [];
      const streckenIndex = new Map<number, any[]>();
      
      linesData.features.forEach((feat: any) => {
        const nr = feat.properties.ISR_STRE_NR;
        if (nr) {
          if (!streckenIndex.has(nr)) streckenIndex.set(nr, []);
          streckenIndex.get(nr)!.push(feat);
        }
      });

      ruhenPoints.forEach((rp: any) => {
        const nr = rp.properties.streckennummer;
        if (nr) {
          const segments = streckenIndex.get(Number(nr)) || streckenIndex.get(parseInt(nr, 10)) || [];
          segments.forEach((seg) => {
            ruhenFeatures.push({
              type: 'Feature',
              geometry: seg.geometry,
              properties: { ...rp.properties },
            });
          });
        }
      });

      const ruhenLinesFc = { type: 'FeatureCollection', features: ruhenFeatures };
      const sourceName = 'si-ruhen-lines';
      const existingSource = map.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(ruhenLinesFc);
      } else {
        map.addSource(sourceName, { type: 'geojson', data: ruhenLinesFc });
        map.addLayer({
          id: 'si-ruhen-lines',
          type: 'line',
          source: sourceName,
          paint: {
            'line-width': 5,
            'line-color': '#8e44ad',
            'line-opacity': 0.85,
            'line-dasharray': [2, 2],
          },
        });
      }
    }
  }, [mapLoaded, streckeninfoData, linesData]);

  // 5. Update Live-Züge & Interpolate Animation (5fps)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const trips = liveTripsData ? (realtimeOnly ? liveTripsData.filter((z: any) => z.realTime) : liveTripsData) : [];
    tripsRef.current = trips;

    // Clean up markers that are no longer present
    const activeIds = new Set(trips.map((t) => t.id));
    for (const [id, marker] of tripMarkersRef.current.entries()) {
      if (!activeIds.has(id)) {
        marker.remove();
        tripMarkersRef.current.delete(id);
      }
    }

    // Add or update markers
    trips.forEach((zug) => {
      let marker = tripMarkersRef.current.get(zug.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'live-train-marker';
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '50%';
        el.style.border = '1.5px solid #ffffff';
        el.style.backgroundColor = CATEGORY_COLOR[zug.category as keyof typeof CATEGORY_COLOR] || '#8894a0';
        el.style.cursor = 'pointer';

        marker = new maplibregl.Marker({ element: el })
          .setLngLat([0, 0])
          .addTo(map);

        const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const fmt = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const delayTxt = zug.delayMin > 0 ? `<span style="color:#ef4444">+${zug.delayMin} min</span>` : (zug.delayMin < 0 ? `${zug.delayMin} min` : 'pünktlich');
        
        const popupContent = `
          <h3>${esc(zug.name || 'Zug')}</h3>
          <table>
            <tr><td class="k">von → nach</td><td>${esc(zug.fromName)} → ${esc(zug.toName)}</td></tr>
            <tr><td class="k">planmäßig</td><td>ab ${fmt(zug.schedDepartMs)} · an ${fmt(zug.schedArriveMs)}</td></tr>
            <tr><td class="k">aktuell</td><td>ab ${fmt(zug.departMs)} · an ${fmt(zug.arriveMs)}</td></tr>
            <tr><td class="k">Verspätung</td><td>${delayTxt}</td></tr>
            <tr><td class="k">Echtzeit</td><td>${zug.realTime ? 'ja' : 'nein (Plan)'}</td></tr>
          </table>
        `;

        const popup = new maplibregl.Popup({ offset: 10 }).setHTML(popupContent);
        marker.setPopup(popup);
        tripMarkersRef.current.set(zug.id, marker);
      }
    });
  }, [mapLoaded, liveTripsData, realtimeOnly]);

  // Interpolation Loop
  useEffect(() => {
    let animInterval: NodeJS.Timeout;

    const updatePositions = () => {
      const now = Date.now();
      tripsRef.current.forEach((zug) => {
        const marker = tripMarkersRef.current.get(zug.id);
        if (!marker) return;

        const span = zug.arriveMs - zug.departMs;
        const frac = span > 0 ? (now - zug.departMs) / span : 0;
        const pos = positionAt(zug.track, frac);
        if (pos) {
          marker.setLngLat([pos[1], pos[0]]);
        }
      });
    };

    animInterval = setInterval(updatePositions, 200); // 5fps
    return () => clearInterval(animInterval);
  }, []);

  // 6. Zoom to Searched Route / Strecken Nummer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !searchResult) return;

    const nr = Number(searchResult);
    if (isNaN(nr) || !linesData) return;

    const matching = linesData.features.filter((f: any) => f.properties.ISR_STRE_NR === nr);
    if (matching.length === 0) {
      onStatusUpdate(`Strecke ${nr} nicht in den Kartendaten gefunden.`);
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    matching.forEach((f: any) => {
      if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach((coord: [number, number]) => bounds.extend(coord));
      } else if (f.geometry.type === 'MultiLineString') {
        f.geometry.coordinates.forEach((line: [number, number][]) => {
          line.forEach((coord: [number, number]) => bounds.extend(coord));
        });
      }
    });

    map.fitBounds(bounds, { padding: 40 });

    if (map.getLayer('highlighted-strecke')) {
      map.removeLayer('highlighted-strecke');
      map.removeSource('highlighted-strecke');
    }

    map.addSource('highlighted-strecke', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: matching },
    });

    map.addLayer({
      id: 'highlighted-strecke',
      type: 'line',
      source: 'highlighted-strecke',
      paint: {
        'line-color': '#ef4444',
        'line-width': 4.5,
        'line-opacity': 0.95,
      },
    });

    onStatusUpdate(`Strecke ${nr}: ${matching.length} Abschnitt(e) fokussiert.`);
  }, [searchResult, mapLoaded]);

  // 7. Render Calculated Route
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const removeRouteLayers = () => {
      if (map.getLayer('route-lines')) map.removeLayer('route-lines');
      if (map.getLayer('route-points')) map.removeLayer('route-points');
      if (map.getSource('route')) map.removeSource('route');
    };

    if (!routeData) {
      removeRouteLayers();
      return;
    }

    removeRouteLayers();

    const routeFeatures: any[] = [];
    routeData.segments.forEach((seg: any) => {
      const lineCoords = seg.coords.map(([lat, lon]: [number, number]) => [lon, lat]);
      routeFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: lineCoords,
        },
        properties: {
          strecke: seg.strecke,
        },
      });
    });

    const startPoint = [routeData.from.lon, routeData.from.lat];
    const zielPoint = [routeData.to.lon, routeData.to.lat];

    routeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: startPoint },
      properties: { label: 'Start', name: routeData.from.name, rl100: routeData.from.rl100 },
    });
    routeFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: zielPoint },
      properties: { label: 'Ziel', name: routeData.to.name, rl100: routeData.to.rl100 },
    });

    const routeFc = { type: 'FeatureCollection', features: routeFeatures };
    map.addSource('route', { type: 'geojson', data: routeFc });

    map.addLayer({
      id: 'route-lines',
      type: 'line',
      source: 'route',
      filter: ['==', '$type', 'LineString'],
      paint: {
        'line-color': '#ef4444',
        'line-width': 5,
        'line-opacity': 0.95,
      },
    });

    map.addLayer({
      id: 'route-points',
      type: 'circle',
      source: 'route',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111111',
        'circle-color': [
          'match',
          ['get', 'label'],
          'Start', '#10b981',
          '#ef4444',
        ],
      },
    });

    const bounds = new maplibregl.LngLatBounds();
    routeFeatures.forEach((f: any) => {
      if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach((coord: [number, number]) => bounds.extend(coord));
      } else {
        bounds.extend(f.geometry.coordinates);
      }
    });

    map.fitBounds(bounds, { padding: 50 });
  }, [routeData, mapLoaded]);

  // 8. Right-click contextmenu
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleContextMenu = (e: maplibregl.MapMouseEvent & maplibregl.EventData) => {
      e.originalEvent.preventDefault();

      const boxSize = 8;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - boxSize, e.point.y - boxSize],
        [e.point.x + boxSize, e.point.y + boxSize]
      ];

      const checkLayers = [
        'streckenabschnitte', 'betriebsstellen', 'tunnel', 'bruecken',
        'bahnuebergaenge', 'streckenuebergaenge', 'si-stoerungen',
        'si-baustellen', 'si-ruhen', 'si-ruhen-lines'
      ].filter((l) => map.getLayer(l));

      const hits = map.queryRenderedFeatures(bbox, { layers: checkLayers });
      if (hits.length === 0) return;

      const uniqueHits: any[] = [];
      const seenKeys = new Set();
      
      hits.forEach((h: any) => {
        const props = h.properties;
        let key = '';
        if (props.ISR_STRE_NR != null) key = `strecke-${props.ISR_STRE_NR}-${props.STRECKEN_ABSCHNITT}`;
        else if (props.STEL_ID) key = `stel-${props.STEL_ID}`;
        else if (props.baustellenID) key = `baustelle-${props.baustellenID}`;
        else if (props.streckenruhenId) key = `ruhe-${props.streckenruhenId}`;
        else if (props.key) key = `stoerung-${props.key}`;
        else key = `${h.layer.id}-${JSON.stringify(props)}`;

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueHits.push(h);
        }
      });

      if (uniqueHits.length === 0) return;

      if (popupRef.current) popupRef.current.remove();

      if (uniqueHits.length === 1) {
        showFeatureDetails(uniqueHits[0], e.lngLat);
        return;
      }

      const popupDiv = document.createElement('div');
      popupDiv.className = 'nearby-popup-content';
      
      const title = document.createElement('div');
      title.className = 'nearby-title';
      title.textContent = `${uniqueHits.length} Elemente in der Nähe:`;
      popupDiv.appendChild(title);

      uniqueHits.forEach((h, index) => {
        const item = document.createElement('div');
        item.className = 'nearby-item';

        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.backgroundColor = h.layer.paint?.['line-color'] || h.layer.paint?.['circle-color'] || '#8894a0';
        
        const txt = document.createElement('span');
        let kind = h.layer.id;
        let label = 'Element';
        const p = h.properties;

        if (h.layer.id === 'streckenabschnitte') {
          kind = 'Strecke';
          label = `Strecke ${p.ISR_STRE_NR} · ${p.ISR_STRECKE_VON_BIS || ''}`;
        } else if (h.layer.id === 'betriebsstellen') {
          kind = 'Betriebsstelle';
          label = `${p.BST_STELLE_NAME} (${p.BST_RL100})`;
        } else if (h.layer.id === 'tunnel') {
          kind = 'Tunnel';
          label = p.ALG_TUNNELNAME || 'Tunnel';
        } else if (h.layer.id === 'bruecken') {
          kind = 'Brücke';
          label = p.ALG_BRUECKENNAME || 'Brücke';
        } else if (h.layer.id === 'bahnuebergaenge') {
          kind = 'Bahnübergang';
          label = p.ALG_BAHNUEBERGANGNAME || 'Bahnübergang';
        } else if (h.layer.id === 'si-stoerungen') {
          kind = 'Störung';
          label = p.cause || 'Störung';
        } else if (h.layer.id === 'si-baustellen') {
          kind = 'Baustelle';
          label = p.arbeiten || 'Baustelle';
        } else if (h.layer.id === 'si-ruhen' || h.layer.id === 'si-ruhen-lines') {
          kind = 'Streckenruhe';
          label = p.bstLangname || 'Streckenruhe';
        }

        txt.innerHTML = `<span class="kind">${kind}</span><span class="label">${label}</span>`;
        item.appendChild(dot);
        item.appendChild(txt);

        item.addEventListener('click', () => {
          popupRef.current?.remove();
          showFeatureDetails(h, e.lngLat);
        });

        popupDiv.appendChild(item);
      });

      popupRef.current = new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setDOMContent(popupDiv)
        .addTo(map);
    };

    map.on('contextmenu', handleContextMenu);
    return () => {
      map.off('contextmenu', handleContextMenu);
    };
  }, [mapLoaded, linesData, streckeninfoData]);

  // Setup click popups for normal layers
  const setupPopups = (map: maplibregl.Map) => {
    const handleLayerClick = (layerId: string, popupHtmlBuilder: (props: any) => string) => {
      map.on('click', layerId, (e) => {
        if (!e.features || e.features.length === 0) return;
        const feat = e.features[0]!;
        
        if (popupRef.current) popupRef.current.remove();

        popupRef.current = new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(popupHtmlBuilder(feat.properties))
          .addTo(map);
      });

      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    };

    const LABELS = {
      ISR_STRE_NR:'Streckennr.', STRECKEN_ABSCHNITT:'Abschnitt', ISR_STRECKE_VON_BIS:'von – bis',
      ISR_KM_VON:'km von', ISR_KM_BIS:'km bis', ALG_LAENGE_ABSCHNITT:'Länge (km)',
      ALG_INFRA_BETR:'Betreiber', ALG_STAAT:'Staat', ALG_STRECKENKLASSE:'Streckenklasse',
      ALG_VERKEHRSART:'Verkehrsart', ALG_TEN_KLASSIFIZIERUNG_PV:'TEN Personenv.',
      ALG_TEN_KLASSIFIZIERUNG_GV:'TEN Güterv.', ALG_MIN_LIRA_PROFIL:'LiRa-Profil (min)',
      ALG_KV_PROFIL:'KV-Profil', INF_GLEISANZAHL:'Gleisanzahl', INF_TRAKTIONSART:'Traktionsart',
      INF_KOMM_SYSTEM:'Kommunikation', BET_GESCHWINDIGKEIT:'V max (km/h)',
      BET_GESCHWINDIGKEIT_CLUSTER:'V-Cluster', LST_PZB:'PZB', LST_LZB:'LZB',
      LST_ETCS_LEVEL_VERS:'ETCS', ENE_TRAKT_STROMART:'Stromart',
    };
    const ORDER = Object.keys(LABELS);

    handleLayerClick('streckenabschnitte', (p) => {
      const rows = ORDER.filter((k) => p[k] != null && p[k] !== '')
        .map((k) => `<tr><td class="k">${LABELS[k as keyof typeof LABELS]}</td><td>${String(p[k])}</td></tr>`).join('');
      return `<h3>Strecke ${p.ISR_STRE_NR ?? '?'}</h3><table>${rows}</table>`;
    });

    handleLayerClick('betriebsstellen', (p) => {
      const rows = [
        ['Name', p.BST_STELLE_NAME],
        ['RL100', p.BST_RL100],
        ['km', p.LAGE_KM_V],
        ['Art', p.BST_STELLENART]
      ].filter(([,v]) => v != null && v !== '').map(([k,v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
      return `<h3>Betriebsstelle</h3><table>${rows}</table>`;
    });

    handleLayerClick('tunnel', (p) => {
      const rows = [
        ['Strecke', p.DET_STR_NR],
        ['Länge (m)', p.ALG_TUNNELLAENGE],
        ['Art', p.ALG_TUNNELART],
        ['TSI-konf.', p.ALG_TSI_KONF],
        ['Notausgang', p.ALG_TUNN_NOTAUS_KZ]
      ].filter(([,v]) => v != null && v !== '').map(([k,v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
      return `<h3>Tunnel: ${p.ALG_TUNNELNAME ?? ''}</h3><table>${rows}</table>`;
    });

    handleLayerClick('bruecken', (p) => {
      const rows = [
        ['Strecke', p.DET_STR_NR],
        ['Länge (m)', p.ALG_BRUECKENLAENGE],
        ['km von', p.KMVON_V],
        ['km bis', p.KMBIS_V]
      ].filter(([,v]) => v != null && v !== '').map(([k,v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
      return `<h3>Brücke: ${p.ALG_BRUECKENNAME ?? ''}</h3><table>${rows}</table>`;
    });

    handleLayerClick('bahnuebergaenge', (p) => {
      const rows = [
        ['Strecke', p.ALG_DBNETZ_STRECKE],
        ['Sicherungsart', p.ALG_SICHERUNGSART],
        ['Kreuzungspartner', p.ALG_KREUZUNGSPARTNER]
      ].filter(([,v]) => v != null && v !== '').map(([k,v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
      return `<h3>Bahnübergang: ${p.ALG_BAHNUEBERGANGNAME ?? ''}</h3><table>${rows}</table>`;
    });
  };

  const showFeatureDetails = (h: any, lngLat: maplibregl.LngLat) => {
    const map = mapRef.current;
    if (!map) return;

    let content = '';
    const p = h.properties;

    const tablePopup = (title: string, rows: [string, any][]) => {
      return `<h3>${title}</h3><table>` +
        rows.filter(([,v]) => v != null && v !== '').map(([k,v]) =>
          `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('') + '</table>';
    };

    const siZeitraum = (beginn: string, ende: string) => {
      const fmtDate = (s: string) => s ? new Date(s).toLocaleString('de-DE') : '';
      const a = fmtDate(beginn), b = fmtDate(ende);
      return (a && b) ? `${a} – ${b}` : (a || b || '');
    };

    if (h.layer.id === 'streckenabschnitte') {
      const LABELS = {
        ISR_STRE_NR:'Streckennr.', STRECKEN_ABSCHNITT:'Abschnitt', ISR_STRECKE_VON_BIS:'von – bis',
        INF_GLEISANZAHL:'Gleisanzahl', INF_TRAKTIONSART:'Traktionsart', BET_GESCHWINDIGKEIT:'V max (km/h)',
      };
      const rows = Object.keys(LABELS).map((k) => `<tr><td class="k">${LABELS[k as keyof typeof LABELS]}</td><td>${String(p[k] ?? '')}</td></tr>`).join('');
      content = `<h3>Strecke ${p.ISR_STRE_NR ?? '?'}</h3><table>${rows}</table>`;
    } else if (h.layer.id === 'betriebsstellen') {
      content = tablePopup('Betriebsstelle', [['Name', p.BST_STELLE_NAME], ['RL100', p.BST_RL100], ['Art', p.BST_STELLENART]]);
    } else if (h.layer.id === 'tunnel') {
      content = tablePopup(`Tunnel: ${p.ALG_TUNNELNAME ?? ''}`, [['Strecke', p.DET_STR_NR], ['Länge (m)', p.ALG_TUNNELLAENGE]]);
    } else if (h.layer.id === 'bruecken') {
      content = tablePopup(`Brücke: ${p.ALG_BRUECKENNAME ?? ''}`, [['Strecke', p.DET_STR_NR], ['Länge (m)', p.ALG_BRUECKENLAENGE]]);
    } else if (h.layer.id === 'bahnuebergaenge') {
      content = tablePopup(`Bahnübergang: ${p.ALG_BAHNUEBERGANGNAME ?? ''}`, [['Strecke', p.ALG_DBNETZ_STRECKE], ['Sicherungsart', p.ALG_SICHERUNGSART]]);
    } else if (h.layer.id === 'si-stoerungen') {
      let wirkungsText = '';
      try {
        const wirkungen = typeof p.wirkungen === 'string' ? JSON.parse(p.wirkungen) : p.wirkungen;
        if (Array.isArray(wirkungen)) {
          wirkungsText = wirkungen.map((w: any) => `${w.wirkung} (${w.verkehrsarten?.join('/')})`).join('; ');
        }
      } catch (_) {}

      content = tablePopup(p.cause || 'Störung', [
        ['Text', p.text],
        ['Wirkung', wirkungsText || p.wirkung],
        ['Einschränkung', p.gleisEinschraenkung],
        ['Zeitraum', siZeitraum(p.beginn, p.ende)]
      ]);
    } else if (h.layer.id === 'si-baustellen') {
      const vonBis = `${p.langnameVon || ''} → ${p.langnameBis || ''}`;
      content = tablePopup(p.arbeiten || 'Baustelle', [
        ['von → bis', vonBis],
        ['Richtung', p.richtung],
        ['Wirkung', p.wirkung],
        ['Einschränkung', p.gleisEinschraenkung],
        ['Zeitraum', siZeitraum(p.beginn, p.ende)]
      ]);
    } else if (h.layer.id === 'si-ruhen' || h.layer.id === 'si-ruhen-lines') {
      content = tablePopup(p.bstLangname || 'Streckenruhe', [
        ['Arbeiten', p.arbeiten],
        ['Strecke', p.streckennummer],
        ['Region', p.region],
        ['Zeitraum', siZeitraum(p.beginn, p.ende)]
      ]);
    }

    if (!content) return;

    popupRef.current = new maplibregl.Popup()
      .setLngLat(lngLat)
      .setHTML(content)
      .addTo(map);
  };

  return <div ref={mapContainer} className="map-container" />;
}
