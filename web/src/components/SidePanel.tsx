'use client';

// Linke, fest angedockte Seitenleiste (ohne Header): Einfärbung, Streckensuche,
// Routenfindung, Legende, Statuszeilen-Block (Strecken / Streckeninfo / Live-Züge)
// und Sammelmeldungen – Reihenfolge wie im Alt-Frontend.
import type { ReactNode } from 'react';
import { GRAU, type ColorMode } from '@/map/strecken';

/** Statuszeile des Strecken-Ladens: frac 0..1 = Balken, null = unbestimmt,
 *  undefined = kein Balken mehr (fertig bzw. Fehler). */
export interface StreckenStatus {
  text: string;
  frac?: number | null;
}

/** Legenden je Einfärbungsmodus (Farben/Texte wie im Alt-Frontend). */
const LEGENDS: Record<ColorMode, Array<[string, string]>> = {
  elektr: [['#2f7fe0', 'Oberleitung'], ['#9b59d0', 'Stromschiene'], ['#e8863b', 'nicht elektrifiziert'], [GRAU, 'keine Angabe']],
  gleis: [['#2f7fe0', 'Richtungsgleis'], ['#38b48b', 'Gegengleis'], ['#e8863b', 'eingleisig'], [GRAU, 'keine Angabe']],
  uniform: [['#2f7fe0', 'Strecke']],
  speed: [['#c0245e', '≥ 230 km/h'], ['#e34a6f', '160–229'], ['#f0883e', '120–159'], ['#e8c135', '100–119'], ['#7bbf4a', '80–99'], ['#3d9970', '< 80'], [GRAU, 'k. A.']],
};

interface SidePanelProps {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  streckenStatus: StreckenStatus;
  /** Statuszeile „Streckeninfo: N Störungen · …" (leer = ausgeblendet). */
  streckeninfoStatus: string;
  trainsStatus: string;
  /** Inhalts-Slots (Suche, Routing, Sammelmeldungen) in Panel-Reihenfolge. */
  searchSlot?: ReactNode;
  routingSlot?: ReactNode;
  sammelSlot?: ReactNode;
}

export default function SidePanel({
  colorMode, onColorModeChange, streckenStatus, streckeninfoStatus, trainsStatus,
  searchSlot, routingSlot, sammelSlot,
}: SidePanelProps) {
  const { text, frac } = streckenStatus;
  return (
    <div className="panel">
      <div className="panel-body">
        <label htmlFor="colorMode">Einfärbung</label>
        <select
          id="colorMode"
          value={colorMode}
          onChange={(e) => onColorModeChange(e.target.value as ColorMode)}
        >
          <option value="elektr">Elektrifizierung</option>
          <option value="speed">Höchstgeschwindigkeit</option>
          <option value="gleis">Gleisanzahl</option>
          <option value="uniform">Einfarbig</option>
        </select>

        {searchSlot}
        {routingSlot}

        <div className="legend">
          {LEGENDS[colorMode].map(([farbe, beschriftung]) => (
            <div className="item" key={`${farbe}-${beschriftung}`}>
              <span className="swatch" style={{ background: farbe }} />
              {beschriftung}
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
        {streckeninfoStatus ? <div className="status-line">{streckeninfoStatus}</div> : null}
        {trainsStatus ? <div className="status-line">{trainsStatus}</div> : null}

        {sammelSlot}
      </div>
    </div>
  );
}
