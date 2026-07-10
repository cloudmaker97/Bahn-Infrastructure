'use client';

// Map application: connects the imperative map world (useMapLayers) with the
// React UI state (color mode, visibilities, status lines, counters) and lays
// out the panel, layer control, and version badge. All visible text is German.
import { useEffect, useState } from 'react';
import type { RouteResult } from '@/lib/types';
import { OVERLAY_ENTRIES, type OverlayKey } from '@/map/isr-overlays';
import { type NetworkStatusCategory, type NetworkStatusPanelData } from '@/map/network-status';
import { type ColorMode } from '@/map/rail-network';
import AggregateNotices from './AggregateNotices';
import LayerControl, { type LayerEntry } from './LayerControl';
import RoutingForm from './RoutingForm';
import SearchForm from './SearchForm';
import SidePanel, { type StreckenStatus } from './SidePanel';
import { useMapLayers } from './use-map-layers';
import VersionBadge from './VersionBadge';

export default function MapApp() {
  const [colorMode, setColorMode] = useState<ColorMode>('electrification');
  // Defaults as in the old frontend: live trains ON, sub-filter "Nur Echtzeit" ON,
  // disruptions ON, construction/closures and all ISR overlays OFF.
  const [liveOn, setLiveOn] = useState(true);
  const [realtimeOnly, setRealtimeOnly] = useState(true);
  const [siOn, setSiOn] = useState<Record<NetworkStatusCategory, boolean>>({
    disruption: true, construction: false, closure: false,
  });
  const [overlayOn, setOverlayOn] = useState<Partial<Record<OverlayKey, boolean>>>({});

  const [streckenStatus, setStreckenStatus] = useState<StreckenStatus>({ text: 'Lade Daten …', frac: null });
  const [siStatus, setSiStatus] = useState('');
  const [trainsStatus, setTrainsStatus] = useState('');
  const [siDaten, setSiDaten] = useState<NetworkStatusPanelData | null>(null);
  const [overlayCounts, setOverlayCounts] = useState<Partial<Record<OverlayKey, number>>>({});

  const layers = useMapLayers({
    onRailStatus: (text, frac) => setStreckenStatus({ text, frac }),
    onNetworkStatusText: setSiStatus,
    onNetworkStatusData: setSiDaten,
    onTrainsStatus: setTrainsStatus,
    onOverlayCount: (key, count) => setOverlayCounts((prev) => ({ ...prev, [key]: count })),
  });

  // Pass the UI state down to the (imperative) layers.
  useEffect(() => { layers.railNetwork.current?.setColorMode(colorMode); }, [layers, colorMode]);
  useEffect(() => {
    const trains = layers.trains.current;
    if (!trains) return;
    if (liveOn) trains.start();
    else trains.stop();
  }, [layers, liveOn]);
  useEffect(() => { layers.trains.current?.setRealtimeOnly(realtimeOnly); }, [layers, realtimeOnly]);
  useEffect(() => {
    const si = layers.networkStatus.current;
    if (!si) return;
    for (const [category, on] of Object.entries(siOn) as Array<[NetworkStatusCategory, boolean]>) {
      si.setVisible(category, on);
    }
  }, [layers, siOn]);
  useEffect(() => {
    const overlays = layers.overlays.current;
    if (!overlays) return;
    for (const [key, on] of Object.entries(overlayOn) as Array<[OverlayKey, boolean]>) {
      overlays.setVisible(key, on);
    }
  }, [layers, overlayOn]);

  // Line search: highlight + zoom in the layer, status message as in the old frontend.
  const handleSearch = (nr: string): void => {
    const n = layers.railNetwork.current?.search(nr) ?? 0;
    setStreckenStatus({ text: n > 0 ? `Strecke ${nr}: ${n} Abschnitt(e)` : `Strecke ${nr} nicht gefunden` });
  };

  // Layer control: entries + per-key toggle actions built together (no string
  // protocol to parse). Live trains, network status (after the first load),
  // divider, ISR overlays (once their counters have loaded).
  const layerItems: LayerEntry[] = [
    { key: 'live', label: 'Live-Züge', checked: liveOn },
    { key: 'live-rt', label: 'Nur Echtzeit', checked: realtimeOnly, indent: true },
  ];
  const toggles: Record<string, (on: boolean) => void> = {
    live: setLiveOn,
    'live-rt': setRealtimeOnly,
  };
  if (siDaten) {
    const statusEntries: Array<{ category: NetworkStatusCategory; label: string; count: number; indent?: boolean }> = [
      { category: 'disruption', label: 'Störungen', count: siDaten.counts.disruptions },
      { category: 'construction', label: 'Baustellen', count: siDaten.counts.constructionSites, indent: true },
      { category: 'closure', label: 'Streckenruhen', count: siDaten.counts.lineClosures, indent: true },
    ];
    for (const { category, label, count, indent } of statusEntries) {
      const key = `si-${category}`;
      layerItems.push({ key, label, count, checked: siOn[category], indent });
      toggles[key] = (on) => setSiOn((prev) => ({ ...prev, [category]: on }));
    }
  }
  const overlayItems: LayerEntry[] = [];
  for (const entry of OVERLAY_ENTRIES) {
    const count = overlayCounts[entry.key];
    if (count == null) continue; // offer only once the data has loaded
    const key = `ov-${entry.key}`;
    overlayItems.push({ key, label: entry.label, count, checked: overlayOn[entry.key] ?? false });
    toggles[key] = (on) => setOverlayOn((prev) => ({ ...prev, [entry.key]: on }));
  }
  if (overlayItems.length) layerItems.push({ key: 'sep-overlays', divider: true }, ...overlayItems);

  const handleToggle = (key: string, on: boolean): void => toggles[key]?.(on);

  return (
    <>
      <div id="map" ref={layers.mapDiv} />
      <SidePanel
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        streckenStatus={streckenStatus}
        streckeninfoStatus={siStatus}
        trainsStatus={trainsStatus}
        searchSlot={<SearchForm onSearch={handleSearch} />}
        routingSlot={(
          <RoutingForm
            onRoute={(route: RouteResult) => layers.route.current?.show(route)}
            onClear={() => layers.route.current?.clear()}
          />
        )}
        sammelSlot={<AggregateNotices items={siDaten?.aggregateNotices ?? []} />}
      />
      <LayerControl items={layerItems} onToggle={handleToggle} />
      <VersionBadge />
    </>
  );
}
