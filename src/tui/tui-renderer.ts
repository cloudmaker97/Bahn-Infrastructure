// Erzeugt aus dem TUI-Zustand den Bildschirm-Frame (String). Verantwortung: Rendering (SRP).
// Keine Seiteneffekte, keine IO -> gut testbar. Fuer Strecken wird die Abschnittsliste angezeigt.
import { ESC, bold, dim, inv, c, pad, stripAnsi, KIND_COLOR } from './ansi.js';
import type { AbschnittLookup, AbschnittProps, SearchEntry } from '../types.js';

export interface TuiState {
  query: string;
  results: SearchEntry[];
  sel: number;
  mode: 'list' | 'detail';
  detailScroll: number;
  filter: SearchEntry['kind'] | null; // null = ALLE
}

/** Zyklus der Filter fuer Tab/Shift+Tab: ALLE (null) + alle Ergebnistypen. */
export const FILTER_CYCLE: (SearchEntry['kind'] | null)[] =
  [null, 'Betriebsstelle', 'Strecke', 'Tunnel', 'Brücke', 'Bahnübergang'];

export interface TuiContext {
  url: string;
  requestCount: number;
  totalObjects: number;
}

export class TuiRenderer {
  constructor(private abschnitte: AbschnittLookup) {}

  render(state: TuiState, ctx: TuiContext, cols: number, rows: number): string {
    const W = Math.max(60, cols);
    const H = Math.max(16, rows);
    const lines: string[] = [];

    lines.push(bold(c('36', ' ISR · Streckennetz Deutschland — Recherche')));
    lines.push(dim(` Karte: ${ctx.url}   ·   HTTP-Anfragen: ${ctx.requestCount}   ·   ${ctx.totalObjects.toLocaleString('de-DE')} Objekte`));
    lines.push(dim('─'.repeat(W)));

    const cursor = state.mode === 'list' ? inv(' ') : ' ';
    lines.push(` ${bold('Suche')} ▸ ${state.query}${cursor}`);
    lines.push(this.filterBar(state.filter));
    lines.push('');

    if (state.mode === 'detail') this.renderDetail(state, W, H, lines);
    else this.renderList(state, W, H, lines);

    while (lines.length < H - 1) lines.push('');
    lines[H - 1] = dim(' ' + (state.mode === 'detail'
      ? '↑↓ scrollen   ·   Esc/Enter: zurück   ·   Ctrl+C: beenden'
      : '↑↓ wählen   ·   Enter: Details   ·   Tab: Typ filtern   ·   Esc: Suche leeren   ·   Ctrl+C: beenden'));

    let buf = `${ESC}[H`;
    for (let i = 0; i < H; i++) buf += (lines[i] ?? '') + `${ESC}[K` + (i < H - 1 ? '\r\n' : '');
    buf += `${ESC}[J`;
    return buf;
  }

  /** Filter-Leiste: aktiver Ergebnistyp invertiert, uebrige gedimmt/koloriert. */
  private filterBar(active: SearchEntry['kind'] | null): string {
    const chip = (label: string, filter: SearchEntry['kind'] | null): string => {
      const isActive = filter === active;
      const text = ` ${label} `;
      if (isActive) return inv(text);
      return filter ? c(KIND_COLOR[filter], text) : dim(text);
    };
    const chips = FILTER_CYCLE.map((f) => chip(f ?? 'ALLE', f));
    return ` ${dim('Filter:')}${chips.join(dim('·'))}`;
  }

  private renderList(state: TuiState, W: number, H: number, lines: string[]): void {
    if (!state.query) {
      lines.push(dim(' Tippe einen RL100-Code, eine Streckennummer oder einen Namen …'));
      lines.push('');
      lines.push(dim(' Beispiele:  AH (Hamburg Hbf) · 1733 · München · Nürnberg'));
      return;
    }
    lines.push(dim(` ${state.results.length} Treffer${state.results.length >= 500 ? '+' : ''}`));
    const rowsAvail = H - lines.length - 2;
    const start = Math.max(0, Math.min(state.sel - (rowsAvail >> 1), state.results.length - rowsAvail));
    const from = Math.max(0, start);
    state.results.slice(from, from + rowsAvail).forEach((e, i) => {
      const idx = from + i;
      const row = ` ${pad(c(KIND_COLOR[e.kind], `[${e.kind}]`), 16)} ${bold(pad(e.code, 8))} `
        + `${pad(e.name, Math.max(10, W - 60))} ${dim(e.detail)}`;
      lines.push(idx === state.sel ? inv(' ' + stripAnsi(row).slice(1)) : row);
    });
  }

  private renderDetail(state: TuiState, W: number, H: number, lines: string[]): void {
    const e = state.results[state.sel];
    if (!e) { lines.push(dim(' (kein Eintrag)')); return; }
    lines.push(` ${c(KIND_COLOR[e.kind], '[' + e.kind + ']')} ${bold(e.code)} — ${bold(e.name)}`);
    lines.push(dim('─'.repeat(W)));

    const body = e.kind === 'Strecke' ? this.streckenBody(e, W) : this.fieldBody(e, W);

    const avail = H - lines.length - 2;
    const maxScroll = Math.max(0, body.length - avail);
    const scroll = Math.min(state.detailScroll, maxScroll);
    for (const line of body.slice(scroll, scroll + avail)) lines.push(line);
    if (maxScroll > 0) {
      const shown = Math.min(scroll + avail, body.length);
      lines.push(dim(` — Zeile ${scroll + 1}–${shown} von ${body.length}${scroll < maxScroll ? '  ↓ mehr' : ''} —`));
    }
  }

  /** Body fuer eine Strecke: Kurzinfo + scrollbare Abschnittsliste. */
  private streckenBody(e: SearchEntry, W: number): string[] {
    const nr = Number(e.code);
    const list = this.abschnitte.byStrecke(nr);
    const body: string[] = [];
    const d = e.data;
    if (d['betreiber']) body.push(` ${c('90', pad('Betreiber', 14))}  ${d['betreiber']}`);
    if (d['staat']) body.push(` ${c('90', pad('Staat', 14))}  ${d['staat']}`);
    body.push(` ${c('90', pad('Abschnitte', 14))}  ${list.length}`);
    body.push('');
    body.push(bold(` Abschnitte (${list.length}):`));
    // Spaltenkopf
    body.push(dim(` ${pad('km von → bis', 22)} ${pad('von – bis', W - 58)} ${pad('Länge', 8)} ${pad('V', 5)} Gleis`));
    for (const a of list) body.push(this.abschnittRow(a, W));
    return body;
  }

  private abschnittRow(a: AbschnittProps, W: number): string {
    const km = `${a.ISR_KM_VON ?? '?'} → ${a.ISR_KM_BIS ?? '?'}`;
    const vonBis = String(a.ISR_STRECKE_VON_BIS ?? '');
    const laenge = String(a.ALG_LAENGE_ABSCHNITT ?? '').trim();
    const v = String(a.BET_GESCHWINDIGKEIT ?? '').trim();
    const gleis = String(a.INF_GLEISANZAHL ?? '');
    return ` ${pad(km, 22)} ${pad(vonBis, W - 58)} ${pad(laenge + ' km', 8)} ${pad(v, 5)} ${dim(gleis)}`;
  }

  /** Body fuer alle anderen Entitaeten: alle nicht-leeren Felder. */
  private fieldBody(e: SearchEntry, W: number): string[] {
    const entries = Object.entries(e.data).filter(([, v]) => v != null && v !== '' && v !== '-');
    const keyW = Math.min(28, Math.max(4, ...entries.map(([k]) => k.length)));
    return entries.map(([k, v]) => ` ${c('90', pad(k, keyW))}  ${pad(String(v), W - keyW - 4)}`);
  }
}
