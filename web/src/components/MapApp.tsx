'use client';

// Map application: connects the imperative map world (useMapLayers) with the
// React UI state (color mode, visibilities, status lines, counters) and lays
// out the panel, layer control, and version badge. All visible text is German.
import { useEffect, useState } from 'react';
import type { DeparturesStation, RouteResult } from '@/lib/types';
import { OVERLAY_ENTRIES, type OverlayKey } from '@/map/isr-overlays';
import { type NetworkStatusCategory, type NetworkStatusPanelData } from '@/map/network-status';
import { type ColorMode } from '@/map/rail-network';
import AggregateNotices from './AggregateNotices';
import DeparturesPanel from './DeparturesPanel';
import LayerControl, { type LayerEntry } from './LayerControl';
import RoutingForm from './RoutingForm';
import SearchForm from './SearchForm';
import SidePanel, { type RailNetworkStatus } from './SidePanel';
import { useMapLayers } from './use-map-layers';
import VersionBadge from './VersionBadge';

export default function MapApp() {
  const [colorMode, setColorMode] = useState<ColorMode>('uniform');
  // Defaults: uniform line color ("Einfarbig"), live trains ON, sub-filter
  // "Nur Echtzeit" ON, "Nur Fernverkehr" OFF, disruptions ON,
  // construction/closures and overlays OFF.
  const [liveOn, setLiveOn] = useState(true);
  const [realtimeOnly, setRealtimeOnly] = useState(true);
  const [longDistanceOnly, setLongDistanceOnly] = useState(false);
  const [statusOn, setStatusOn] = useState<Record<NetworkStatusCategory, boolean>>({
    disruption: true, construction: false, closure: false,
  });
  const [overlayOn, setOverlayOn] = useState<Partial<Record<OverlayKey, boolean>>>({});
  // Departures panel: closed by default; opens via the operating-point popup
  // button or the collapsed "Abfahrten" toggle at the bottom right.
  const [departuresOpen, setDeparturesOpen] = useState(false);
  const [departuresStation, setDeparturesStation] = useState<DeparturesStation | null>(null);

  const [railNetworkStatus, setRailNetworkStatus] = useState<RailNetworkStatus>({ text: 'Lade Daten …', frac: null });
  const [networkStatusText, setNetworkStatusText] = useState('');
  const [trainsStatus, setTrainsStatus] = useState('');
  const [networkStatusData, setNetworkStatusData] = useState<NetworkStatusPanelData | null>(null);
  const [overlayCounts, setOverlayCounts] = useState<Partial<Record<OverlayKey, number>>>({});

  const layers = useMapLayers({
    onRailStatus: (text, frac) => setRailNetworkStatus({ text, frac }),
    onNetworkStatusText: setNetworkStatusText,
    onNetworkStatusData: setNetworkStatusData,
    onTrainsStatus: setTrainsStatus,
    onOverlayCount: (key, count) => setOverlayCounts((prev) => ({ ...prev, [key]: count })),
    onShowDepartures: (station) => {
      setDeparturesStation(station);
      setDeparturesOpen(true);
    },
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
  useEffect(() => { layers.trains.current?.setLongDistanceOnly(longDistanceOnly); }, [layers, longDistanceOnly]);
  useEffect(() => {
    const si = layers.networkStatus.current;
    if (!si) return;
    for (const [category, on] of Object.entries(statusOn) as Array<[NetworkStatusCategory, boolean]>) {
      si.setVisible(category, on);
    }
  }, [layers, statusOn]);
  useEffect(() => {
    const overlays = layers.overlays.current;
    if (!overlays) return;
    for (const [key, on] of Object.entries(overlayOn) as Array<[OverlayKey, boolean]>) {
      overlays.setVisible(key, on);
    }
  }, [layers, overlayOn]);

  // Unified search (line / RL100 / live train): MapSearch zooms and returns
  // the status line for the panel.
  const handleSearch = (q: string): void => {
    void layers.search.current?.search(q).then((text) => {
      if (text) setRailNetworkStatus({ text });
    });
  };

  // Layer control: entries + per-key toggle actions built together (no string
  // protocol to parse). Live trains, network status (after the first load),
  // divider, ISR overlays (once their counters have loaded).
  const layerItems: LayerEntry[] = [
    { key: 'live', label: 'Live-Züge', checked: liveOn },
    { key: 'live-rt', label: 'Nur Echtzeit', checked: realtimeOnly, indent: true },
    { key: 'live-ld', label: 'Nur Fernverkehr', checked: longDistanceOnly, indent: true },
  ];
  const toggles: Record<string, (on: boolean) => void> = {
    live: setLiveOn,
    'live-rt': setRealtimeOnly,
    'live-ld': setLongDistanceOnly,
  };
  if (networkStatusData) {
    const statusEntries: Array<{ category: NetworkStatusCategory; label: string; count: number; indent?: boolean }> = [
      { category: 'disruption', label: 'Störungen', count: networkStatusData.counts.disruptions },
      { category: 'construction', label: 'Baustellen', count: networkStatusData.counts.constructionSites, indent: true },
      { category: 'closure', label: 'Streckenruhen', count: networkStatusData.counts.lineClosures, indent: true },
    ];
    for (const { category, label, count, indent } of statusEntries) {
      const key = `ns-${category}`;
      layerItems.push({ key, label, count, checked: statusOn[category], indent });
      toggles[key] = (on) => setStatusOn((prev) => ({ ...prev, [category]: on }));
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
        railNetworkStatus={railNetworkStatus}
        networkStatusText={networkStatusText}
        trainsStatus={trainsStatus}
        searchSlot={<SearchForm onSearch={handleSearch} />}
        routingSlot={(
          <RoutingForm
            onRoute={(route: RouteResult) => layers.route.current?.show(route)}
            onClear={() => layers.route.current?.clear()}
          />
        )}
        noticesSlot={<AggregateNotices items={networkStatusData?.aggregateNotices ?? []} />}
      />
      <LayerControl items={layerItems} onToggle={handleToggle} />
      {departuresOpen ? (
        <DeparturesPanel
          station={departuresStation}
          onSelectStation={setDeparturesStation}
          onClose={() => setDeparturesOpen(false)}
        />
      ) : (
        <button type="button" className="departures-toggle" onClick={() => setDeparturesOpen(true)}>
          Abfahrten
        </button>
      )}
      <VersionBadge />
    </>
  );
}
