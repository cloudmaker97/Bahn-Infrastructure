// Right-click "elements nearby": since trains/notices sit on top of the lines,
// a left click only hits the topmost object. Right click collects all
// interactive features in a ±14 px bbox (registry of the MapController): a
// single hit opens its popup directly, multiple hits open a clickable
// selection list (DOM content with real event listeners, popup.setDOMContent).
import type { MapMouseEvent } from 'maplibre-gl';
import { NEUTRAL_GREY } from './color-scales';
import type { InteractiveHit, MapController } from './controller';

/** Pixel radius of the bbox around the click point. */
const NEARBY_RADIUS_PX = 14;
/** Width of the selection list (popup maxWidth; the list itself styles .nearby). */
const LIST_MAX_WIDTH_PX = 320;

/** Merges identical features from multiple layers (e.g. line + highlight). */
function dedup(hits: InteractiveHit[]): InteractiveHit[] {
  const seen = new Set<string>();
  const out: InteractiveHit[] = [];
  for (const hit of hits) {
    const f = hit.feature;
    const key = `${f.source}|${f.id ?? ''}|${JSON.stringify(f.properties ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export class NearbyPicker {
  // Bound handler so dispose() can unregister it again.
  private readonly onContextMenu = (e: MapMouseEvent): void => this.handle(e);

  constructor(private controller: MapController) {
    controller.map.on('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.controller.map.off('contextmenu', this.onContextMenu);
  }

  private handle(e: MapMouseEvent): void {
    e.originalEvent?.preventDefault(); // suppress the browser context menu
    const hits = dedup(this.controller.queryInteractiveAt(e.point, NEARBY_RADIUS_PX));
    if (!hits.length) return;
    if (hits.length === 1) {
      const hit = hits[0]!;
      this.controller.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature));
      return;
    }
    this.controller.openPopup(e.lngLat, this.buildList(hits, e), LIST_MAX_WIDTH_PX);
  }

  /** Selection list as DOM (clicking an entry opens its popup). */
  private buildList(hits: InteractiveHit[], e: MapMouseEvent): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'nearby';
    const title = document.createElement('b');
    title.textContent = `${hits.length} Elemente in der Nähe`;
    wrap.appendChild(title);
    for (const hit of hits) {
      const item = document.createElement('div');
      item.className = 'nearby-item';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hit.spec.dotColor?.(hit.feature) ?? NEUTRAL_GREY;
      const txt = document.createElement('span');
      txt.className = 'txt';
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = hit.spec.kindLabel(hit.feature);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = hit.spec.nearbyLabel?.(hit.feature) ?? hit.spec.kindLabel(hit.feature);
      txt.append(kind, label);
      item.append(dot, txt);
      // openPopup closes the selection list automatically (only one popup at a time).
      item.addEventListener('click', () =>
        this.controller.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature)));
      wrap.appendChild(item);
    }
    return wrap;
  }
}
