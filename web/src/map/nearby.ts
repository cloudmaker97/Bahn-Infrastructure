// Right-click / long-press "elements nearby": since trains/notices sit on top
// of the lines, a left click only hits the topmost object. Right click (and a
// 500 ms long-press on touch) collects all interactive features in a ±14 px
// bbox (registry of the MapController): a single hit opens its popup directly,
// multiple hits open a clickable selection list (DOM content with real event
// listeners, popup.setDOMContent).
import type { LngLat, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { NEUTRAL_GREY } from './color-scales';
import type { InteractiveHit, MapController } from './controller';

/** Pixel radius of the bbox around the click point. */
const NEARBY_RADIUS_PX = 14;
/** Width of the selection list (popup maxWidth; the list itself styles .nearby). */
const LIST_MAX_WIDTH_PX = 320;
/** Touch hold duration before the nearby list opens (mobile has no right-click). */
const LONG_PRESS_MS = 500;
/** Finger travel that cancels a pending long-press (map pan). */
const MOVE_CANCEL_PX = 12;

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
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressOrigin: { x: number; y: number } | null = null;
  private ignoreNextClick = false;

  private readonly onContextMenu = (e: MapMouseEvent): void => {
    e.originalEvent?.preventDefault();
    this.showAt(e.point, e.lngLat);
  };
  private readonly onTouchStart = (e: MapTouchEvent): void => this.beginPress(e);
  private readonly onTouchMove = (e: MapTouchEvent): void => this.shiftPress(e);
  private readonly onTouchEnd = (): void => this.clearPress();
  private readonly onDomClickCapture = (e: MouseEvent): void => {
    if (!this.ignoreNextClick) return;
    this.ignoreNextClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  constructor(private controller: MapController) {
    controller.map.on('contextmenu', this.onContextMenu);
    controller.map.on('touchstart', this.onTouchStart);
    controller.map.on('touchmove', this.onTouchMove);
    controller.map.on('touchend', this.onTouchEnd);
    controller.map.on('touchcancel', this.onTouchEnd);
    this.canvas()?.addEventListener('click', this.onDomClickCapture, true);
  }

  dispose(): void {
    this.clearPress();
    this.controller.map.off('contextmenu', this.onContextMenu);
    this.controller.map.off('touchstart', this.onTouchStart);
    this.controller.map.off('touchmove', this.onTouchMove);
    this.controller.map.off('touchend', this.onTouchEnd);
    this.controller.map.off('touchcancel', this.onTouchEnd);
    this.canvas()?.removeEventListener('click', this.onDomClickCapture, true);
  }

  private canvas(): HTMLCanvasElement | null {
    try { return this.controller.map.getCanvas(); }
    catch { return null; }
  }

  private beginPress(e: MapTouchEvent): void {
    if (e.originalEvent.touches.length !== 1) {
      this.clearPress();
      return;
    }
    this.clearPress();
    this.pressOrigin = { x: e.point.x, y: e.point.y };
    const point = e.point;
    const lngLat = e.lngLat;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      if (this.showAt(point, lngLat)) this.ignoreNextClick = true;
    }, LONG_PRESS_MS);
  }

  private shiftPress(e: MapTouchEvent): void {
    if (!this.pressOrigin) return;
    const dx = e.point.x - this.pressOrigin.x;
    const dy = e.point.y - this.pressOrigin.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) this.clearPress();
  }

  private clearPress(): void {
    if (this.pressTimer != null) clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.pressOrigin = null;
  }

  private showAt(point: { x: number; y: number }, lngLat: LngLat): boolean {
    const hits = dedup(this.controller.queryInteractiveAt(point, NEARBY_RADIUS_PX));
    if (!hits.length) return false;
    if (hits.length === 1) {
      const hit = hits[0]!;
      this.controller.openPopup(lngLat, hit.spec.popupHtml(hit.feature));
      return true;
    }
    this.controller.openPopup(lngLat, this.buildList(hits, lngLat), LIST_MAX_WIDTH_PX);
    return true;
  }

  /** Selection list as DOM (clicking an entry opens its popup). */
  private buildList(hits: InteractiveHit[], lngLat: LngLat): HTMLElement {
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
        this.controller.openPopup(lngLat, hit.spec.popupHtml(hit.feature)));
      wrap.appendChild(item);
    }
    return wrap;
  }
}
