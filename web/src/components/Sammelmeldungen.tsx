'use client';

// Sammelmeldungen (Störungen ohne Verortung) als ein-/ausklappbare Box unten im
// linken Panel; bei 0 Einträgen komplett ausgeblendet (wie im Alt-Frontend).
import { fmtZeitraum } from '@/lib/format';
import type { SammelmeldungDTO } from '@/lib/types';

/** Lange Meldungstexte auf eine lesbare Kurzform stutzen. */
const KURZTEXT_MAX = 160;

interface SammelmeldungenProps {
  items: SammelmeldungDTO[];
}

export default function Sammelmeldungen({ items }: SammelmeldungenProps) {
  if (!items.length) return null;
  return (
    <div className="sammel">
      <details open>
        <summary>Sammelmeldungen ({items.length})</summary>
        <div className="list">
          {items.map((s, i) => {
            const text = (s.text || '').trim();
            const kurz = text.length > KURZTEXT_MAX ? `${text.slice(0, KURZTEXT_MAX)} …` : text;
            const zeit = fmtZeitraum(s.beginn, s.ende);
            return (
              <div className="item" key={s.key || `${s.cause}-${i}`}>
                <div className="titel">{s.cause || 'Sammelmeldung'}</div>
                {kurz ? <div className="text">{kurz}</div> : null}
                {zeit ? <div className="zeit">{zeit}</div> : null}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
