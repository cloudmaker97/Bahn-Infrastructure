'use client';

// Hook that owns the imperative map world: builds the MapController and all
// layer modules once, wires their status callbacks, and tears everything down
// on unmount. MapApp stays a thin React component on top (SRP: construction/
// lifecycle here, UI state there).
import { useEffect, useRef, type RefObject } from 'react';
import type { DeparturesStation } from '@/lib/types';
import { MapController } from '@/map/controller';
import { IsrOverlays, type OverlayKey } from '@/map/isr-overlays';
import { NearbyPicker } from '@/map/nearby';
import { NetworkStatusLayers, type NetworkStatusPanelData } from '@/map/network-status';
import { RailNetworkLayer } from '@/map/rail-network';
import { RouteLayer } from '@/map/route';
import { MapSearch } from '@/map/search';
import { TrainsLayer } from '@/map/trains';

export interface MapLayerCallbacks {
  onRailStatus(text: string, frac?: number | null): void;
  onNetworkStatusText(text: string): void;
  onNetworkStatusData(data: NetworkStatusPanelData): void;
  onTrainsStatus(text: string): void;
  onOverlayCount(key: OverlayKey, count: number): void;
  /** "Nächste Abfahrten" clicked in an operating-point popup. */
  onShowDepartures(station: DeparturesStation): void;
}

export interface MapLayerHandles {
  mapDiv: RefObject<HTMLDivElement | null>;
  railNetwork: RefObject<RailNetworkLayer | null>;
  trains: RefObject<TrainsLayer | null>;
  networkStatus: RefObject<NetworkStatusLayers | null>;
  overlays: RefObject<IsrOverlays | null>;
  route: RefObject<RouteLayer | null>;
  search: RefObject<MapSearch | null>;
}

export function useMapLayers(callbacks: MapLayerCallbacks): MapLayerHandles {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const railNetwork = useRef<RailNetworkLayer | null>(null);
  const trains = useRef<TrainsLayer | null>(null);
  const networkStatus = useRef<NetworkStatusLayers | null>(null);
  const overlays = useRef<IsrOverlays | null>(null);
  const route = useRef<RouteLayer | null>(null);
  const search = useRef<MapSearch | null>(null);

  // The callbacks only forward into React state setters (stable); keep the
  // latest set in a ref so the one-time construction effect never goes stale.
  const cbs = useRef(callbacks);
  cbs.current = callbacks;

  // Build map + layers once (and tear everything down on unmount).
  useEffect(() => {
    if (!mapDiv.current) return;
    const controller = new MapController(mapDiv.current);
    const rail = new RailNetworkLayer(controller, (text, frac) => cbs.current.onRailStatus(text, frac));
    const trainsLayer = new TrainsLayer(controller, (text) => cbs.current.onTrainsStatus(text), { realtimeOnly: true });
    const status = new NetworkStatusLayers(
      controller, rail,
      (text) => cbs.current.onNetworkStatusText(text),
      (data) => cbs.current.onNetworkStatusData(data),
    );
    const isrOverlays = new IsrOverlays(
      controller, rail,
      (key, count) => cbs.current.onOverlayCount(key, count),
      (station) => cbs.current.onShowDepartures(station),
    );
    const routeLayer = new RouteLayer(controller);
    const nearby = new NearbyPicker(controller);
    railNetwork.current = rail;
    trains.current = trainsLayer;
    networkStatus.current = status;
    overlays.current = isrOverlays;
    route.current = routeLayer;
    search.current = new MapSearch(controller, rail, trainsLayer);

    // Redraw the closure lines once the line geometry (line index) is loaded.
    void rail.load().then(() => status.rebuildClosures());
    status.start();
    isrOverlays.loadAll();

    controller.onReady(() => {
      // E2E hooks: expose map, controller, and layer modules globally.
      (window as unknown as Record<string, unknown>)['__ISR__'] = {
        map: controller.map, controller, trains: trainsLayer, networkStatus: status, overlays: isrOverlays,
      };
    });

    return () => {
      nearby.dispose();
      status.dispose();
      trainsLayer.dispose();
      controller.dispose();
      railNetwork.current = null;
      trains.current = null;
      networkStatus.current = null;
      overlays.current = null;
      route.current = null;
      search.current = null;
    };
  }, []);

  return { mapDiv, railNetwork, trains, networkStatus, overlays, route, search };
}
