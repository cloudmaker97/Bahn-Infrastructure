// Single source of the rail-network color modes: scale data, MapLibre color
// expressions, plain-value colors (nearby dots), and the panel legends are all
// derived from the tables below — change a color/threshold in ONE place.
// Legend labels and the matched property VALUES are German (DB InfraGO data).
import type { DataDrivenPropertyValueSpecification, ExpressionSpecification } from 'maplibre-gl';

export type ColorMode = 'electrification' | 'speed' | 'tracks' | 'uniform';

/** Grey for "no data" (also used by the SidePanel legend). */
export const NEUTRAL_GREY = '#8894a0';

/** Single color of the 'uniform' mode (and legend entry "Strecke"). */
export const UNIFORM_COLOR = '#2f7fe0';

/** Electrification: DB value -> color (values are upstream data, labels = values). */
const ELECTRIFICATION_COLORS: Record<string, string> = {
  Oberleitung: '#2f7fe0',
  Stromschiene: '#9b59d0',
  'nicht elektrifiziert': '#e8863b',
};

/** Track count: DB value -> color. */
const TRACK_COLORS: Record<string, string> = {
  Richtungsgleis: '#2f7fe0',
  Gegengleis: '#38b48b',
  eingleisig: '#e8863b',
};

/** Speed steps ascending (from km/h inclusive); labels for the legend. */
const SPEED_STEPS: ReadonlyArray<{ from: number; color: string; label: string }> = [
  { from: 0, color: '#3d9970', label: '< 80' },
  { from: 80, color: '#7bbf4a', label: '80–99' },
  { from: 100, color: '#e8c135', label: '100–119' },
  { from: 120, color: '#f0883e', label: '120–159' },
  { from: 160, color: '#e34a6f', label: '160–229' },
  { from: 230, color: '#c0245e', label: '≥ 230 km/h' },
];

// V max as a number; -1 as the fallback for non-numeric strings (e.g. "k. A.").
const SPEED_NUM: ExpressionSpecification = ['to-number', ['get', 'BET_GESCHWINDIGKEIT'], -1];

/**
 * 'match' expression from a value->color table. The spread defeats TypeScript's
 * tuple typing for ExpressionSpecification, hence the unknown cast (the shape
 * is exactly ['match', input, v1, c1, ..., fallback]).
 */
function matchExpression(property: string, table: Record<string, string>): ExpressionSpecification {
  return [
    'match', ['get', property],
    ...Object.entries(table).flat(),
    NEUTRAL_GREY,
  ] as unknown as ExpressionSpecification;
}

/** Data-driven line color per color mode (derived from the tables above). */
export const COLOR_EXPR: Record<ColorMode, DataDrivenPropertyValueSpecification<string>> = {
  electrification: matchExpression('INF_TRAKTIONSART', ELECTRIFICATION_COLORS),
  tracks: matchExpression('INF_GLEISANZAHL', TRACK_COLORS),
  speed: [
    'case',
    // Missing/empty -> grey ("to-number" would turn null/'' into 0, not -1).
    ['!', ['has', 'BET_GESCHWINDIGKEIT']], NEUTRAL_GREY,
    ['==', ['get', 'BET_GESCHWINDIGKEIT'], ''], NEUTRAL_GREY,
    ['<', SPEED_NUM, 0], NEUTRAL_GREY,
    ['step', SPEED_NUM,
      SPEED_STEPS[0]!.color,
      ...SPEED_STEPS.slice(1).flatMap((s) => [s.from, s.color]),
    ] as ExpressionSpecification,
  ],
  uniform: UNIFORM_COLOR,
};

/**
 * Color of a section for non-expression contexts (color dot of the nearby
 * selection list); mirrors COLOR_EXPR by construction (same tables).
 */
export function colorForProps(p: Record<string, unknown>, mode: ColorMode): string {
  if (mode === 'uniform') return UNIFORM_COLOR;
  if (mode === 'speed') {
    const s = parseInt(String(p['BET_GESCHWINDIGKEIT'] ?? ''), 10);
    if (Number.isNaN(s)) return NEUTRAL_GREY;
    for (let i = SPEED_STEPS.length - 1; i >= 0; i--) {
      if (s >= SPEED_STEPS[i]!.from) return SPEED_STEPS[i]!.color;
    }
    return NEUTRAL_GREY;
  }
  const table = mode === 'tracks' ? TRACK_COLORS : ELECTRIFICATION_COLORS;
  const value = String(p[mode === 'tracks' ? 'INF_GLEISANZAHL' : 'INF_TRAKTIONSART'] ?? '');
  return table[value] ?? NEUTRAL_GREY;
}

/** Legends per color mode for the SidePanel (German labels, product language). */
export const LEGENDS: Record<ColorMode, Array<[string, string]>> = {
  electrification: [
    ...Object.entries(ELECTRIFICATION_COLORS).map(([value, color]) => [color, value] as [string, string]),
    [NEUTRAL_GREY, 'keine Angabe'],
  ],
  tracks: [
    ...Object.entries(TRACK_COLORS).map(([value, color]) => [color, value] as [string, string]),
    [NEUTRAL_GREY, 'keine Angabe'],
  ],
  uniform: [[UNIFORM_COLOR, 'Strecke']],
  speed: [
    ...[...SPEED_STEPS].reverse().map((s) => [s.color, s.label] as [string, string]),
    [NEUTRAL_GREY, 'k. A.'],
  ],
};
