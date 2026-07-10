'use client';

// Aggregate notices (disruptions without a location) as a collapsible box at the
// bottom of the left panel; hidden entirely at 0 entries (as in the old frontend).
import { fmtPeriod } from '@/lib/format';
import type { AggregateNoticeDTO } from '@/lib/types';

interface AggregateNoticesProps {
  items: AggregateNoticeDTO[];
}

export default function AggregateNotices({ items }: AggregateNoticesProps) {
  if (!items.length) return null;
  return (
    <div className="notices">
      <details open>
        <summary>Sammelmeldungen ({items.length})</summary>
        <div className="list">
          {items.map((s, i) => {
            // Full text, no length limit – the list itself scrolls.
            const text = (s.text || '').trim();
            const period = fmtPeriod(s.start, s.end);
            return (
              <div className="item" key={s.key || `${s.cause}-${i}`}>
                <div className="title">{s.cause || 'Sammelmeldung'}</div>
                {text ? <div className="text">{text}</div> : null}
                {period ? <div className="period">{period}</div> : null}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
