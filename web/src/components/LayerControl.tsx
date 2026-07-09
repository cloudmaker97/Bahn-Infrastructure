'use client';

// Ebenen-Steuerung oben rechts (Panel-Optik): Checkbox-Zeilen, optional eingerückt
// (Unter-Filter) und mit de-DE-formatiertem Zähler; Trennlinien gliedern die
// Gruppen (Live/Streckeninfo vs. ISR-Overlays).

/** Ein Checkbox-Eintrag der Ebenen-Steuerung. */
export interface LayerItem {
  key: string;
  label: string;
  checked: boolean;
  /** Eingerückter Unter-Filter (z. B. „Nur Echtzeit" unter „Live-Züge"). */
  indent?: boolean;
  /** Optionaler Zähler hinter dem Label, z. B. „Betriebsstellen (12.345)". */
  count?: number;
}

/** Trennlinie zwischen Eintrags-Gruppen. */
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
