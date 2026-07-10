// Produces the screen frame (string) from the TUI state. Responsibility: rendering (SRP).
// No side effects, no IO -> easy to test. Lines show their section list.
// All rendered text is user-facing and intentionally German (product language).
import { ESC, bold, dim, inv, c, pad, stripAnsi, wrap, KIND_COLOR, KIND_LABEL } from './ansi.js';
import type { SectionLookup, SectionProps, SearchEntry } from '../types.js';
import type { NetworkStatusResult } from '../types.js';

export type TuiMode = 'list' | 'detail' | 'notices';

export interface NoticesView {
  status: 'idle' | 'loading' | 'refreshing' | 'ready';
  data: NetworkStatusResult | null;
}

export interface TuiState {
  query: string;
  results: SearchEntry[];
  sel: number;
  mode: TuiMode;
  detailScroll: number;
  filter: SearchEntry['kind'] | null; // null = ALL
  notices: NoticesView;
  noticesScroll: number;
  notice: string | null; // transient status message (browser opened, data refresh, …)
}

/** Cycle of the filters for Tab/Shift+Tab: ALL (null) + every result kind. */
export const FILTER_CYCLE: (SearchEntry['kind'] | null)[] =
  [null, 'station', 'line', 'tunnel', 'bridge', 'level-crossing'];

export interface TuiContext {
  url: string;
  requestCount: number;
  totalObjects: number;
}

export class TuiRenderer {
  constructor(private sections: SectionLookup) {}

  render(state: TuiState, ctx: TuiContext, cols: number, rows: number): string {
    const W = Math.max(60, cols);
    const H = Math.max(16, rows);
    const lines: string[] = [];

    lines.push(bold(c('36', ' ISR · Streckennetz Deutschland — Recherche')));
    lines.push(dim(` Karte: ${ctx.url}   ·   HTTP-Anfragen: ${ctx.requestCount}   ·   ${ctx.totalObjects.toLocaleString('de-DE')} Objekte`));
    if (state.notice) lines.push(c('33', ' ▸ ' + state.notice));
    lines.push(dim('─'.repeat(W)));

    const cursor = state.mode === 'list' ? inv(' ') : ' ';
    lines.push(` ${bold('Suche')} ▸ ${state.query}${cursor}`);
    lines.push(this.filterBar(state.filter));
    lines.push('');

    if (state.mode === 'detail') this.renderDetail(state, W, H, lines);
    else if (state.mode === 'notices') this.renderNotices(state, W, H, lines);
    else this.renderList(state, W, H, lines);

    while (lines.length < H - 1) lines.push('');
    const footer = state.mode === 'detail'
      ? '↑↓ scrollen   ·   Esc/Enter: zurück   ·   Ctrl+C: beenden'
      : state.mode === 'notices'
      ? '↑↓ scrollen   ·   r: aktualisieren   ·   Esc/q: zurück   ·   Ctrl+C: beenden'
      : '↑↓ wählen   ·   Enter: Details   ·   Ctrl+B: Meldungen   ·   Tab: filtern   ·   Ctrl+O: Browser   ·   Ctrl+R: Daten neu   ·   Ctrl+C: beenden';
    lines[H - 1] = dim(' ' + footer);

    let buf = `${ESC}[H`;
    for (let i = 0; i < H; i++) buf += (lines[i] ?? '') + `${ESC}[K` + (i < H - 1 ? '\r\n' : '');
    buf += `${ESC}[J`;
    return buf;
  }

  /** Filter bar: the active result kind inverted, the rest dimmed/colored. */
  private filterBar(active: SearchEntry['kind'] | null): string {
    const chip = (label: string, filter: SearchEntry['kind'] | null): string => {
      const isActive = filter === active;
      const text = ` ${label} `;
      if (isActive) return inv(text);
      return filter ? c(KIND_COLOR[filter], text) : dim(text);
    };
    const chips = FILTER_CYCLE.map((f) => chip(f ? KIND_LABEL[f] : 'ALLE', f));
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
      const row = ` ${pad(c(KIND_COLOR[e.kind], `[${KIND_LABEL[e.kind]}]`), 16)} ${bold(pad(e.code, 8))} `
        + `${pad(e.name, Math.max(10, W - 60))} ${dim(e.detail)}`;
      lines.push(idx === state.sel ? inv(' ' + stripAnsi(row).slice(1)) : row);
    });
  }

  private renderDetail(state: TuiState, W: number, H: number, lines: string[]): void {
    const e = state.results[state.sel];
    if (!e) { lines.push(dim(' (kein Eintrag)')); return; }
    lines.push(` ${c(KIND_COLOR[e.kind], '[' + KIND_LABEL[e.kind] + ']')} ${bold(e.code)} — ${bold(e.name)}`);
    lines.push(dim('─'.repeat(W)));

    const body = e.kind === 'line' ? this.lineBody(e, W)
      : e.kind === 'station' ? this.stationBody(e, W)
      : this.fieldBody(e, W);

    this.pushScrollWindow(body, state.detailScroll, H, lines);
  }

  /** Network-status view: disruptions + aggregate notices, scrollable. */
  private renderNotices(state: TuiState, W: number, H: number, lines: string[]): void {
    const nv = state.notices;
    lines.push(bold(c('31', ' Betriebslage — Meldungen')));
    if (nv.status === 'loading') { lines.push(''); lines.push(dim(' Lade Meldungen …')); return; }
    if (nv.status === 'refreshing') lines.push(dim(' Aktualisiere …'));
    const data = nv.data;
    if (!data) { lines.push(''); lines.push(dim(' Keine Daten.')); return; }
    if (data.error) lines.push(c('31', ' Fehler: ' + data.error));
    lines.push(dim(' Stand: ' + data.generatedAt));
    lines.push(dim('─'.repeat(W)));

    const body: string[] = [];
    const disruptions = data.disruptionNotices;
    const aggregates = data.aggregateNotices;
    if (disruptions.length === 0 && aggregates.length === 0 && !data.error) {
      body.push(dim(' Keine aktuellen Meldungen.'));
    }
    if (disruptions.length > 0) {
      body.push(bold(` Störungen (${disruptions.length})`));
      for (const m of disruptions) this.noticeBlock(body, m.cause, m.subcause, m.text,
        m.start, m.end, m.transportModes, m.trackRestriction, m.located ? '' : 'ohne Ort', W);
    }
    if (aggregates.length > 0) {
      if (disruptions.length > 0) body.push('');
      body.push(bold(` Sammelmeldungen (${aggregates.length})`));
      for (const m of aggregates) this.noticeBlock(body, m.cause, m.subcause, m.text,
        m.start, m.end, m.transportModes, '', '', W);
    }

    this.pushScrollWindow(body, state.noticesScroll, H, lines);
  }

  /** Pushes the visible window of `body` (via `scroll`) into `lines` and appends the position line. */
  private pushScrollWindow(body: string[], scroll: number, H: number, lines: string[]): void {
    const avail = H - lines.length - 2;
    const maxScroll = Math.max(0, body.length - avail);
    const clamped = Math.min(scroll, maxScroll);
    for (const line of body.slice(clamped, clamped + avail)) lines.push(line);
    if (maxScroll > 0) {
      const shown = Math.min(clamped + avail, body.length);
      lines.push(dim(` — Zeile ${clamped + 1}–${shown} von ${body.length}${clamped < maxScroll ? '  ↓ mehr' : ''} —`));
    }
  }

  /** One notice block: title line + wrapped text + meta line. */
  private noticeBlock(
    body: string[], cause: string, subcause: string, text: string,
    start: string, end: string, transportModes: string[],
    trackRestriction: string, marker: string, W: number,
  ): void {
    const title = [cause || 'Meldung', subcause].filter(Boolean).join(' – ');
    const mk = marker ? '  ' + dim('(' + marker + ')') : '';
    body.push(' ' + c('33', title) + mk);
    for (const line of wrap(String(text).trim(), Math.max(20, W - 3))) {
      if (line) body.push('   ' + line);
    }
    const meta: string[] = [];
    const period = [start, end].filter(Boolean).join(' – ');
    if (period) meta.push(period);
    if (transportModes.length) meta.push(transportModes.join('/'));
    if (trackRestriction) meta.push('Gleis: ' + trackRestriction);
    if (meta.length) body.push('   ' + dim(meta.join('   ·   ')));
  }

  /** Body for a line: short info + scrollable section list. */
  private lineBody(e: SearchEntry, W: number): string[] {
    const nr = Number(e.code);
    const list = this.sections.byLineNumber(nr);
    const body: string[] = [];
    const d = e.data;
    if (d['operators']) body.push(` ${c('90', pad('Betreiber', 14))}  ${d['operators']}`);
    if (d['countries']) body.push(` ${c('90', pad('Staat', 14))}  ${d['countries']}`);
    body.push(` ${c('90', pad('Abschnitte', 14))}  ${list.length}`);
    body.push('');
    body.push(bold(` Abschnitte (${list.length}):`));
    // Column header
    body.push(dim(` ${pad('km von → bis', 22)} ${pad('von – bis', W - 58)} ${pad('Länge', 8)} ${pad('V', 5)} Gleis`));
    for (const a of list) body.push(this.sectionRow(a, W));
    return body;
  }

  private sectionRow(a: SectionProps, W: number): string {
    const km = `${a.ISR_KM_VON ?? '?'} → ${a.ISR_KM_BIS ?? '?'}`;
    const fromTo = String(a.ISR_STRECKE_VON_BIS ?? '');
    const length = String(a.ALG_LAENGE_ABSCHNITT ?? '').trim();
    const v = String(a.BET_GESCHWINDIGKEIT ?? '').trim();
    const tracks = String(a.INF_GLEISANZAHL ?? '');
    return ` ${pad(km, 22)} ${pad(fromTo, W - 58)} ${pad(length + ' km', 8)} ${pad(v, 5)} ${dim(tracks)}`;
  }

  /** Body for an operating point: base fields + attached lines/sections. */
  private stationBody(e: SearchEntry, W: number): string[] {
    const body = this.fieldBody(e, W);
    const stel = Number(e.data['stel']);
    const list = Number.isFinite(stel) ? this.sections.byStation(stel) : [];
    body.push('');
    body.push(bold(` Zugehörige Strecken/Abschnitte (${list.length}):`));
    if (list.length === 0) { body.push(dim(' (keine)')); return body; }
    body.push(dim(` ${pad('Strecke', 9)} ${pad('von – bis', W - 40)} ${pad('km von → bis', 24)}`));
    for (const a of list) {
      const nr = String(a.ISR_STRE_NR ?? '?');
      const fromTo = String(a.ISR_STRECKE_VON_BIS ?? '');
      const km = `${a.ISR_KM_VON ?? '?'} → ${a.ISR_KM_BIS ?? '?'}`;
      body.push(` ${pad(c(KIND_COLOR['line'], nr), 9)} ${pad(fromTo, W - 40)} ${dim(pad(km, 24))}`);
    }
    return body;
  }

  /** Body for every other entity: all non-empty fields. */
  private fieldBody(e: SearchEntry, W: number): string[] {
    const entries = Object.entries(e.data).filter(([, v]) => v != null && v !== '' && v !== '-');
    const keyW = Math.min(28, Math.max(4, ...entries.map(([k]) => k.length)));
    return entries.map(([k, v]) => ` ${c('90', pad(k, keyW))}  ${pad(String(v), W - keyW - 4)}`);
  }
}
