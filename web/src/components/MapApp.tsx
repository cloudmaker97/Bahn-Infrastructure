'use client';

// Kartenanwendung: verkabelt den React-freien MapController mit den Layer-Modulen
// (Strecken, Live-Züge, Streckeninfo, ISR-Overlays, Route, Nearby) und hält den
// UI-Zustand (Einfärbung, Sichtbarkeiten, Statuszeilen, Zähler).
import { useEffect, useRef, useState } from 'react';
import type { RouteResult } from '@/lib/types';
import { MapController } from '@/map/controller';
import { IsrOverlays, OVERLAY_EINTRAEGE, type OverlayKey } from '@/map/isr-overlays';
import { NearbyPicker } from '@/map/nearby';
import { RouteLayer } from '@/map/route';
import { StreckenLayer, type ColorMode } from '@/map/strecken';
import { StreckenInfoLayers, type SiKategorie, type SiPanelDaten } from '@/map/streckeninfo';
import { TrainsLayer } from '@/map/trains';
import LayerControl, { type LayerEntry } from './LayerControl';
import RoutingForm from './RoutingForm';
import Sammelmeldungen from './Sammelmeldungen';
import SearchForm from './SearchForm';
import SidePanel, { type StreckenStatus } from './SidePanel';
import VersionBadge from './VersionBadge';

export default function MapApp() {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const streckenRef = useRef<StreckenLayer | null>(null);
  const trainsRef = useRef<TrainsLayer | null>(null);
  const streckeninfoRef = useRef<StreckenInfoLayers | null>(null);
  const overlaysRef = useRef<IsrOverlays | null>(null);
  const routeRef = useRef<RouteLayer | null>(null);

  const [colorMode, setColorMode] = useState<ColorMode>('elektr');
  // Standard wie im Alt-Frontend: Live-Züge AN, Unterfilter „Nur Echtzeit" AN,
  // Störungen AN, Baustellen/Streckenruhen und alle ISR-Overlays AUS.
  const [liveOn, setLiveOn] = useState(true);
  const [realtimeOnly, setRealtimeOnly] = useState(true);
  const [siOn, setSiOn] = useState<Record<SiKategorie, boolean>>({
    stoerung: true, baustelle: false, ruhe: false,
  });
  const [overlayOn, setOverlayOn] = useState<Partial<Record<OverlayKey, boolean>>>({});

  const [streckenStatus, setStreckenStatus] = useState<StreckenStatus>({ text: 'Lade Daten …', frac: null });
  const [siStatus, setSiStatus] = useState('');
  const [trainsStatus, setTrainsStatus] = useState('');
  const [siDaten, setSiDaten] = useState<SiPanelDaten | null>(null);
  const [overlayCounts, setOverlayCounts] = useState<Partial<Record<OverlayKey, number>>>({});

  // Karte + Layer einmalig aufbauen (und beim Unmount vollständig abbauen).
  useEffect(() => {
    if (!mapDiv.current) return;
    const controller = new MapController(mapDiv.current);
    const strecken = new StreckenLayer(controller, (text, frac) => setStreckenStatus({ text, frac }));
    const trains = new TrainsLayer(controller, setTrainsStatus, { realtimeOnly: true });
    const streckeninfo = new StreckenInfoLayers(controller, strecken, setSiStatus, setSiDaten);
    const overlays = new IsrOverlays(controller, strecken, (key, count) =>
      setOverlayCounts((prev) => ({ ...prev, [key]: count })));
    const route = new RouteLayer(controller);
    const nearby = new NearbyPicker(controller);
    streckenRef.current = strecken;
    trainsRef.current = trains;
    streckeninfoRef.current = streckeninfo;
    overlaysRef.current = overlays;
    routeRef.current = route;

    // Ruhen-Linien nachziehen, sobald die Strecken-Geometrie (idIndex) geladen ist.
    void strecken.load().then(() => streckeninfo.rebuildRuhen());
    streckeninfo.start();
    overlays.loadAll();

    controller.onReady(() => {
      // E2E-Hooks: Karte, Controller und Layer-Module global verfügbar machen.
      (window as unknown as Record<string, unknown>)['__ISR__'] = {
        map: controller.map, controller, trains, streckeninfo, overlays,
      };
    });

    return () => {
      nearby.dispose();
      streckeninfo.dispose();
      trains.dispose();
      controller.dispose();
      streckenRef.current = null;
      trainsRef.current = null;
      streckeninfoRef.current = null;
      overlaysRef.current = null;
      routeRef.current = null;
    };
  }, []);

  // UI-Zustand an die (imperativen) Layer weiterreichen.
  useEffect(() => { streckenRef.current?.setColorMode(colorMode); }, [colorMode]);
  useEffect(() => {
    const trains = trainsRef.current;
    if (!trains) return;
    if (liveOn) trains.start();
    else trains.stop();
  }, [liveOn]);
  useEffect(() => { trainsRef.current?.setRealtimeOnly(realtimeOnly); }, [realtimeOnly]);
  useEffect(() => {
    const si = streckeninfoRef.current;
    if (!si) return;
    for (const [kat, on] of Object.entries(siOn) as Array<[SiKategorie, boolean]>) si.setVisible(kat, on);
  }, [siOn]);
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    for (const [key, on] of Object.entries(overlayOn) as Array<[OverlayKey, boolean]>) {
      overlays.setVisible(key, on);
    }
  }, [overlayOn]);

  // Streckensuche: Highlight + Zoom im Layer, Status-Meldung wie im Alt-Frontend.
  const handleSearch = (nr: string): void => {
    const n = streckenRef.current?.search(nr) ?? 0;
    setStreckenStatus({ text: n > 0 ? `Strecke ${nr}: ${n} Abschnitt(e)` : `Strecke ${nr} nicht gefunden` });
  };

  // Ebenen-Steuerung: Live-Züge, Streckeninfo (nach erstem Load), Trennlinie,
  // ISR-Overlays (sobald deren Zähler geladen sind) – Reihenfolge wie im Alt-Frontend.
  const layerItems: LayerEntry[] = [
    { key: 'live', label: 'Live-Züge', checked: liveOn },
    { key: 'live-rt', label: 'Nur Echtzeit', checked: realtimeOnly, indent: true },
  ];
  if (siDaten) {
    layerItems.push(
      { key: 'si-stoerung', label: 'Störungen', count: siDaten.counts.stoerungen, checked: siOn.stoerung },
      { key: 'si-baustelle', label: 'Baustellen', count: siDaten.counts.baustellen, checked: siOn.baustelle, indent: true },
      { key: 'si-ruhe', label: 'Streckenruhen', count: siDaten.counts.streckenruhen, checked: siOn.ruhe, indent: true },
    );
  }
  const overlayItems: LayerEntry[] = [];
  for (const eintrag of OVERLAY_EINTRAEGE) {
    const count = overlayCounts[eintrag.key];
    if (count == null) continue; // erst anbieten, wenn die Daten geladen sind
    overlayItems.push({
      key: `ov-${eintrag.key}`, label: eintrag.label, count,
      checked: overlayOn[eintrag.key] ?? false,
    });
  }
  if (overlayItems.length) layerItems.push({ key: 'sep-overlays', divider: true }, ...overlayItems);

  const handleToggle = (key: string, on: boolean): void => {
    if (key === 'live') setLiveOn(on);
    else if (key === 'live-rt') setRealtimeOnly(on);
    else if (key.startsWith('si-')) {
      setSiOn((prev) => ({ ...prev, [key.slice(3) as SiKategorie]: on }));
    } else if (key.startsWith('ov-')) {
      setOverlayOn((prev) => ({ ...prev, [key.slice(3) as OverlayKey]: on }));
    }
  };

  return (
    <>
      <div id="map" ref={mapDiv} />
      <SidePanel
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        streckenStatus={streckenStatus}
        streckeninfoStatus={siStatus}
        trainsStatus={trainsStatus}
        searchSlot={<SearchForm onSearch={handleSearch} />}
        routingSlot={(
          <RoutingForm
            onRoute={(route: RouteResult) => routeRef.current?.show(route)}
            onClear={() => routeRef.current?.clear()}
          />
        )}
        sammelSlot={<Sammelmeldungen items={siDaten?.sammelmeldungen ?? []} />}
      />
      <LayerControl items={layerItems} onToggle={handleToggle} />
      <VersionBadge />
    </>
  );
}
