'use client';

// Left side panel: color mode, line search, route finding, legend, status
// lines and aggregate notices. Docked on desktop; a drawer overlay on narrow
// viewports. All visible text is German.
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
  /** Mobile drawer: open class, dialog semantics, and close control. */
  open?: boolean;
  onClose?: () => void;
  narrow?: boolean;
}

export default function SidePanel({
  colorMode, onColorModeChange, railNetworkStatus, networkStatusText, trainsStatus,
  searchSlot, routingSlot, noticesSlot, open = false, onClose, narrow = false,
}: SidePanelProps) {
  const { text, frac } = railNetworkStatus;
  return (
    <aside
      id="side-panel"
      className={open ? 'panel is-open' : 'panel'}
      role={narrow ? 'dialog' : 'complementary'}
      aria-modal={narrow && open ? true : undefined}
      aria-label="Suche und Route"
      inert={narrow && !open ? true : undefined}
    >
      <div className="drawer-head">
        <span className="drawer-kicker">Suche &amp; Route</span>
        <button type="button" className="drawer-close" aria-label="Menü schließen" onClick={onClose}>✕</button>
      </div>
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
    </aside>
  );
}
