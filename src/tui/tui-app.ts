// Orchestrates the TUI: state + stdin + InputHandler + renderer + search.
// Responsibility: flow control (SRP); rendering and input parsing are external.
// Notice strings are user-facing and intentionally German (product language).
import { InputHandler } from './input-handler.js';
import { TuiRenderer, FILTER_CYCLE, type TuiContext, type TuiState } from './tui-renderer.js';
import { ESC } from './ansi.js';
import type { EntitySearch, NoticesProvider } from '../types.js';

export interface TuiAppOptions {
  getContext: () => TuiContext;
  onQuit: () => void;
  onOpenBrowser?: () => void;               // open the map in the system browser (Ctrl+O)
  onRefreshData?: () => Promise<string>;    // re-scrape/build/load the ISR data -> short stats (Ctrl+R)
}

export class TuiApp {
  private state: TuiState = {
    query: '', results: [], sel: 0, mode: 'list', detailScroll: 0, filter: null,
    notices: { status: 'idle', data: null }, noticesScroll: 0, notice: null,
  };
  private out = process.stdout;
  private dataRefreshing = false;

  constructor(
    private search: EntitySearch,
    private renderer: TuiRenderer,
    private input: InputHandler,
    private notices: NoticesProvider,
    private opts: TuiAppOptions,
  ) {}

  start(): void {
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    this.out.write(`${ESC}[?25l`); // hide the cursor
    stdin.on('data', (k: string) => this.onKey(k));
    this.out.on('resize', () => this.draw());
    this.draw();
  }

  /** Shows a transient status message from outside (e.g. the scheduled data refresh). */
  notify(text: string): void {
    this.state.notice = text;
    this.draw();
  }

  private onKey(key: string): void {
    const action = this.input.parse(key, this.state.mode);
    const s = this.state;
    s.notice = null; // reset the transient status message on every input
    switch (action.type) {
      case 'quit': this.cleanup(); this.opts.onQuit(); return;
      case 'char': s.query += action.ch; this.updateResults(); break;
      case 'backspace': s.query = s.query.slice(0, -1); this.updateResults(); break;
      case 'clear': s.query = ''; this.updateResults(); break;
      case 'up':
        if (s.mode === 'detail') s.detailScroll = Math.max(0, s.detailScroll - 1);
        else if (s.mode === 'notices') s.noticesScroll = Math.max(0, s.noticesScroll - 1);
        else s.sel = Math.max(0, s.sel - 1);
        break;
      case 'down':
        if (s.mode === 'detail') s.detailScroll += 1;
        else if (s.mode === 'notices') s.noticesScroll += 1;
        else s.sel = Math.min(s.results.length - 1, s.sel + 1);
        break;
      case 'enter': if (s.results.length) { s.mode = 'detail'; s.detailScroll = 0; } break;
      case 'back': s.mode = 'list'; break;
      case 'filter-next': this.cycleFilter(1); break;
      case 'filter-prev': this.cycleFilter(-1); break;
      case 'notices-open': this.openNotices(); break;
      case 'refresh': this.refreshNotices(); break;
      case 'open-browser': this.opts.onOpenBrowser?.(); s.notice = 'Karte im Browser geöffnet.'; break;
      case 'refresh-data': this.refreshData(); break;
      case 'none': return;
    }
    this.draw();
  }

  private openNotices(): void {
    const s = this.state;
    s.mode = 'notices';
    s.noticesScroll = 0;
    if (!s.notices.data) {
      s.notices = { status: 'loading', data: null };
      this.loadNotices(false);
    }
  }

  private refreshNotices(): void {
    if (this.state.mode !== 'notices') return;
    this.state.notices = { status: 'refreshing', data: this.state.notices.data };
    this.loadNotices(true);
  }

  /** Ctrl+R: fully re-scrape/build/load the ISR data (runs in the background). */
  private refreshData(): void {
    if (this.dataRefreshing || !this.opts.onRefreshData) return;
    this.dataRefreshing = true;
    this.state.notice = 'ISR-Daten werden neu gescraped und gebaut … (dauert einige Minuten)';
    this.draw();
    void this.opts.onRefreshData().then((summary) => {
      this.state.notice = 'Daten aktualisiert: ' + summary;
      this.updateResults(); // rerun the current search with the new data
    }).catch((e) => {
      this.state.notice = 'Daten-Refresh fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e));
    }).finally(() => {
      this.dataRefreshing = false;
      this.draw();
    });
  }

  /** Fetches data (forced if requested) and redraws when the view is still open. */
  private loadNotices(force: boolean): void {
    void this.notices.getData(force ? { force: true } : undefined).then((data) => {
      this.state.notices = { status: 'ready', data };
      if (this.state.mode === 'notices') this.draw();
    }).catch(() => {
      // getData() should never throw; if it does, do not hang on loading/refreshing.
      this.state.notices = { status: 'ready', data: this.state.notices.data };
      if (this.state.mode === 'notices') this.draw();
    });
  }

  private updateResults(): void {
    this.state.results = this.search.search(this.state.query, 500, this.state.filter);
    this.state.sel = 0;
  }

  /** Cycles the result-kind filter (Tab: +1, Shift+Tab: -1). */
  private cycleFilter(dir: 1 | -1): void {
    const i = FILTER_CYCLE.indexOf(this.state.filter);
    const n = FILTER_CYCLE.length;
    this.state.filter = FILTER_CYCLE[(i + dir + n) % n]!;
    this.updateResults();
  }

  private draw(): void {
    const frame = this.renderer.render(
      this.state, this.opts.getContext(),
      this.out.columns ?? 80, this.out.rows ?? 24);
    this.out.write(frame);
  }

  private cleanup(): void {
    this.out.write(`${ESC}[?25h${ESC}[0m${ESC}[2J${ESC}[H`);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
}
