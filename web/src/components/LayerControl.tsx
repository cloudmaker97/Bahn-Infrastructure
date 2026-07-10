'use client';

// Layer control at the top right (panel look): checkbox rows, optionally
// indented (sub-filters) and with de-DE-formatted counters; dividers separate
// the groups (live/network status vs. ISR overlays).

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
}

export default function LayerControl({ items, onToggle }: LayerControlProps) {
  return (
    <div className="layerctl">
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
    </div>
  );
}
