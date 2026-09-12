'use client';

// Shared mobile breakpoint for layout JS (drawers, inert, exclusive overlays).
// Keep in sync with `@media (max-width: 767px)` in globals.css.
import { useEffect, useState } from 'react';

export const NARROW_VIEWPORT_MQ = '(max-width: 767px)';

/** True when the layout should use collapsible drawers instead of docked panels. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_VIEWPORT_MQ).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_VIEWPORT_MQ);
    const sync = (): void => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return narrow;
}
