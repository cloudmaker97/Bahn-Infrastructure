// Small, pure format/escape helpers for popup content (DRY: shared by the
// rail-network, train, network-status, and overlay modules).

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** HTML-escapes arbitrary values for output in popup markup. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Time of day HH:MM (de-DE) from epoch milliseconds. */
export function fmtTimeHM(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** ISO-like timestamp -> readable date (de-DE), robust against garbage. */
export function fmtDateTime(s: unknown): string {
  if (!s) return '';
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('de-DE');
}

/** Period "start – end" (missing sides are omitted). */
export function fmtPeriod(start: unknown, end: unknown): string {
  const a = fmtDateTime(start);
  const b = fmtDateTime(end);
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
}

/** Popup table "title + key/value rows"; empty values are omitted. */
export function tablePopupHtml(title: string, rows: Array<[string, unknown]>): string {
  const body = rows
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<h3>${escapeHtml(title)}</h3><table>${body}</table>`;
}
