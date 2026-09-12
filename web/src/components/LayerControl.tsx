'use client';

// Layer control at the top right (panel look): basemap switcher, checkbox
// rows, optionally indented (sub-filters) and with de-DE-formatted counters;
// dividers separate the groups (live/network status vs. ISR overlays).
import { BASEMAP_OPTIONS, type BasemapId } from '@/map/basemap';
import SegmentedControl from './SegmentedControl';

/** One checkbox entry of the layer control. */
export interface LayerItem {
  key: string;
  label: string;
  checked: boolean;
  /** Indented sub-filter (e.g. "Nur Echtzeit" under "Live-Züge"). */
  indent?: boolean;
  /** Optional counter after the label, e.g. "Betriebsstellen (12.345)". */
  count?: number;
}

/** Divider between entry groups. */
export interface LayerDivider {
  key: string;
  divider: true;
}

export type LayerEntry = LayerItem | LayerDivider;

interface LayerControlProps {
  items: LayerEntry[];
  onToggle: (key: string, on: boolean) => void;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  /** Mobile drawer: open class, dialog semantics, and close control. */
  open?: boolean;
  onClose?: () => void;
  narrow?: boolean;
}

export default function LayerControl({
  items, onToggle, basemap, onBasemapChange, open = false, onClose, narrow = false,
}: LayerControlProps) {
  return (
    <aside
      id="layer-panel"
      className={open ? 'layerctl is-open' : 'layerctl'}
      role={narrow ? 'dialog' : 'complementary'}
      aria-modal={narrow && open ? true : undefined}
      aria-label="Kartenebenen"
      inert={narrow && !open ? true : undefined}
    >
      <div className="layerctl-head">
        <div className="layerctl-head-row">
          <span className="layerctl-kicker">Karte</span>
          <button type="button" className="drawer-close" aria-label="Ebenen schließen" onClick={onClose}>✕</button>
        </div>
        <SegmentedControl
          ariaLabel="Kartenstil"
          value={basemap}
          onChange={onBasemapChange}
          options={BASEMAP_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        />
      </div>
      <hr className="lc-sep" />
      {items.map((item) => {
        if ('divider' in item) return <hr key={item.key} className="lc-sep" />;
        const text = item.count != null
          ? `${item.label} (${item.count.toLocaleString('de-DE')})`
          : item.label;
        return (
          <label key={item.key} className={item.indent ? 'lc-indent' : undefined}>
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => onToggle(item.key, e.target.checked)}
            />
            {item.indent ? <span className="lc-sub">{text}</span> : <span>{text}</span>}
          </label>
        );
      })}
    </aside>
  );
}
