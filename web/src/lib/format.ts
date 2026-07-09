// Kleine, reine Format-/Escape-Helfer für Popup-Inhalte (DRY: von Strecken-,
// Zug-, Streckeninfo- und Overlay-Modulen gemeinsam genutzt).

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** HTML-escaped beliebige Werte für die Ausgabe in Popup-Markup. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Uhrzeit HH:MM (de-DE) aus Epoch-Millisekunden. */
export function fmtTimeHM(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** ISO-ähnlicher Zeitstempel -> lesbares Datum (de-DE), robust gegen Müll. */
export function fmtDateTime(s: unknown): string {
  if (!s) return '';
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('de-DE');
}

/** Zeitraum „Beginn – Ende" (fehlende Seiten werden weggelassen). */
export function fmtZeitraum(beginn: unknown, ende: unknown): string {
  const a = fmtDateTime(beginn);
  const b = fmtDateTime(ende);
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
}

/** Popup-Tabelle „Titel + Key/Value-Zeilen"; leere Werte werden ausgelassen. */
export function tablePopupHtml(titel: string, rows: Array<[string, unknown]>): string {
  const body = rows
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<h3>${escapeHtml(titel)}</h3><table>${body}</table>`;
}
