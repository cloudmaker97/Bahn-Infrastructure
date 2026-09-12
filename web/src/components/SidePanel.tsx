'use client';

// Left, docked side panel (no header): color mode, line search, route finding,
// legend, status-line block (rail network / network status / live trains) and
// aggregate notices – order as in the old frontend. All visible text is German.
import type { ReactNode } from 'react';
import { LEGENDS, type ColorMode } from '@/map/color-scales';
import SegmentedControl from './SegmentedControl';

/** Status line of the rail-network loading: frac 0..1 = bar, null = indeterminate,
 *  undefined = no bar anymore (done or error). */
export interface RailNetworkStatus {
  text: string;
  frac?: number | null;
}

interface SidePanelProps {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  railNetworkStatus: RailNetworkStatus;
  /** Status line "Streckeninfo: N Störungen · …" (empty = hidden). */
  networkStatusText: string;
  trainsStatus: string;
  /** Content slots (search, routing, aggregate notices) in panel order. */
  searchSlot?: ReactNode;
  routingSlot?: ReactNode;
  noticesSlot?: ReactNode;
}

export default function SidePanel({
  colorMode, onColorModeChange, railNetworkStatus, networkStatusText, trainsStatus,
  searchSlot, routingSlot, noticesSlot,
}: SidePanelProps) {
  const { text, frac } = railNetworkStatus;
  return (
    <div className="panel">
      <div className="panel-body">
        <label id="colorModeLabel">Einfärbung</label>
        <SegmentedControl
          ariaLabel="Einfärbung"
          columns={2}
          value={colorMode}
          onChange={onColorModeChange}
          options={[
            { value: 'uniform', label: 'Einfarbig' },
            { value: 'electrification', label: 'Elektrifizierung' },
            { value: 'speed', label: 'V max' },
            { value: 'tracks', label: 'Gleisanzahl' },
          ]}
        />

        {searchSlot}
        {routingSlot}

        <div className="legend">
          {LEGENDS[colorMode].map(([color, label]) => (
            <div className="item" key={`${color}-${label}`}>
              <span className="swatch" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>

        <div className="status">
          {frac !== undefined && (
            <div className={frac === null ? 'bar indet' : 'bar'}>
              <div
                className="bar-fill"
                style={frac != null ? { width: `${(frac * 100).toFixed(1)}%` } : undefined}
              />
            </div>
          )}
          <span>{text}</span>
        </div>
        {networkStatusText ? <div className="status-line">{networkStatusText}</div> : null}
        {trainsStatus ? <div className="status-line">{trainsStatus}</div> : null}

        {noticesSlot}
      </div>
    </div>
  );
}
