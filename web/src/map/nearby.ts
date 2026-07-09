// Rechtsklick „Elemente in der Nähe": Da Züge/Meldungen auf den Strecken liegen,
// überdeckt beim Linksklick das oberste Objekt die darunterliegenden. Rechtsklick
// sammelt alle interaktiven Features in einer ±14-px-Bbox (Registry des
// MapController): ein Treffer öffnet direkt sein Popup, mehrere eine klickbare
// Auswahlliste (DOM-Inhalt mit echten Event-Listenern, popup.setDOMContent).
import type { MapMouseEvent } from 'maplibre-gl';
import type { InteractiveHit, MapController } from './controller';

/** Pixel-Radius der Bbox um den Klickpunkt. */
const NEARBY_RADIUS_PX = 14;
/** Fallback-Farbpunkt, falls ein Layer keine dotColor liefert. */
const FALLBACK_DOT = '#8894a0';
/** Breite der Auswahlliste (Popup-maxWidth; die Liste selbst stylt .nearby). */
const LIST_MAX_WIDTH_PX = 320;

/** Gleiche Features aus mehreren Layern (z. B. Linie + Highlight) zusammenfassen. */
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
  // Gebundener Handler, damit dispose() ihn wieder abmelden kann.
  private readonly onContextMenu = (e: MapMouseEvent): void => this.handle(e);

  constructor(private controller: MapController) {
    controller.map.on('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.controller.map.off('contextmenu', this.onContextMenu);
  }

  private handle(e: MapMouseEvent): void {
    e.originalEvent?.preventDefault(); // Browser-Kontextmenü unterdrücken
    const hits = dedup(this.controller.queryInteractiveAt(e.point, NEARBY_RADIUS_PX));
    if (!hits.length) return;
    if (hits.length === 1) {
      const hit = hits[0]!;
      this.controller.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature));
      return;
    }
    this.controller.openPopup(e.lngLat, this.buildListe(hits, e), LIST_MAX_WIDTH_PX);
  }

  /** Auswahlliste als DOM (Klick auf einen Eintrag öffnet dessen Popup). */
  private buildListe(hits: InteractiveHit[], e: MapMouseEvent): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'nearby';
    const titel = document.createElement('b');
    titel.textContent = `${hits.length} Elemente in der Nähe`;
    wrap.appendChild(titel);
    for (const hit of hits) {
      const item = document.createElement('div');
      item.className = 'nearby-item';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hit.spec.dotColor?.(hit.feature) ?? FALLBACK_DOT;
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
      // openPopup schließt die Auswahlliste automatisch (nur ein Popup zugleich).
      item.addEventListener('click', () =>
        this.controller.openPopup(e.lngLat, hit.spec.popupHtml(hit.feature)));
      wrap.appendChild(item);
    }
    return wrap;
  }
}
