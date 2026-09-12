'use client';

// Compact segmented control (no rounding): one selected option, used for
// basemap (Dark/Basic), color mode, and routing mode.

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** When set, render as a CSS grid with this many columns (e.g. 2 for color mode). */
  columns?: number;
}

export default function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel, columns,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={columns ? 'seg seg-grid' : 'seg'}
      role="radiogroup"
      aria-label={ariaLabel}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={value === opt.value ? 'seg-btn on' : 'seg-btn'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
