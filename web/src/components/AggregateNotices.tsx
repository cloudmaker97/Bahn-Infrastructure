'use client';

// Aggregate notices (disruptions without a location) as a collapsible box at the
// bottom of the left panel; hidden entirely at 0 entries (as in the old frontend).
import { fmtPeriod } from '@/lib/format';
import type { AggregateNoticeDTO } from '@/lib/types';

/** Trim long notice texts to a readable short form. */
const SHORT_TEXT_MAX = 160;

interface AggregateNoticesProps {
  items: AggregateNoticeDTO[];
}

export default function AggregateNotices({ items }: AggregateNoticesProps) {
  if (!items.length) return null;
  return (
    <div className="sammel">
      <details open>
        <summary>Sammelmeldungen ({items.length})</summary>
        <div className="list">
          {items.map((s, i) => {
            const text = (s.text || '').trim();
            const shortText = text.length > SHORT_TEXT_MAX ? `${text.slice(0, SHORT_TEXT_MAX)} …` : text;
            const period = fmtPeriod(s.start, s.end);
            return (
              <div className="item" key={s.key || `${s.cause}-${i}`}>
                <div className="titel">{s.cause || 'Sammelmeldung'}</div>
                {shortText ? <div className="text">{shortText}</div> : null}
                {period ? <div className="zeit">{period}</div> : null}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
