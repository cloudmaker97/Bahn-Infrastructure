// Orchestriert die TUI: Zustand + stdin + InputHandler + Renderer + Suche.
// Verantwortung: Ablaufsteuerung (SRP); Rendering und Eingabe-Parsing sind ausgelagert.
import { InputHandler } from './input-handler.js';
import { TuiRenderer, FILTER_CYCLE, type TuiContext, type TuiState } from './tui-renderer.js';
import { ESC } from './ansi.js';
import type { EntitySearch, MeldungenProvider } from '../types.js';

export interface TuiAppOptions {
  getContext: () => TuiContext;
  onQuit: () => void;
  onOpenBrowser?: () => void;               // Karte im Systembrowser oeffnen (Ctrl+O)
  onRefreshData?: () => Promise<string>;    // ISR-Daten neu scrapen/bauen/laden -> Kurzstatistik (Ctrl+R)
}

export class TuiApp {
  private state: TuiState = {
    query: '', results: [], sel: 0, mode: 'list', detailScroll: 0, filter: null,
    meldungen: { status: 'idle', data: null }, meldungenScroll: 0, notice: null,
  };
  private out = process.stdout;
  private dataRefreshing = false;

  constructor(
    private search: EntitySearch,
    private renderer: TuiRenderer,
    private input: InputHandler,
    private meldungen: MeldungenProvider,
    private opts: TuiAppOptions,
  ) {}

  start(): void {
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    this.out.write(`${ESC}[?25l`); // Cursor verstecken
    stdin.on('data', (k: string) => this.onKey(k));
    this.out.on('resize', () => this.draw());
    this.draw();
  }

  private onKey(key: string): void {
    const action = this.input.parse(key, this.state.mode);
    const s = this.state;
    s.notice = null; // transiente Statusmeldung bei jeder Eingabe zuruecksetzen
    switch (action.type) {
      case 'quit': this.cleanup(); this.opts.onQuit(); return;
      case 'char': s.query += action.ch; this.updateResults(); break;
      case 'backspace': s.query = s.query.slice(0, -1); this.updateResults(); break;
      case 'clear': s.query = ''; this.updateResults(); break;
      case 'up':
        if (s.mode === 'detail') s.detailScroll = Math.max(0, s.detailScroll - 1);
        else if (s.mode === 'meldungen') s.meldungenScroll = Math.max(0, s.meldungenScroll - 1);
        else s.sel = Math.max(0, s.sel - 1);
        break;
      case 'down':
        if (s.mode === 'detail') s.detailScroll += 1;
        else if (s.mode === 'meldungen') s.meldungenScroll += 1;
        else s.sel = Math.min(s.results.length - 1, s.sel + 1);
        break;
      case 'enter': if (s.results.length) { s.mode = 'detail'; s.detailScroll = 0; } break;
      case 'back': s.mode = 'list'; break;
      case 'filter-next': this.cycleFilter(1); break;
      case 'filter-prev': this.cycleFilter(-1); break;
      case 'meldungen-open': this.openMeldungen(); break;
      case 'refresh': this.refreshMeldungen(); break;
      case 'open-browser': this.opts.onOpenBrowser?.(); s.notice = 'Karte im Browser geöffnet.'; break;
      case 'refresh-data': this.refreshData(); break;
      case 'none': return;
    }
    this.draw();
  }

  private openMeldungen(): void {
    const s = this.state;
    s.mode = 'meldungen';
    s.meldungenScroll = 0;
    if (!s.meldungen.data) {
      s.meldungen = { status: 'loading', data: null };
      this.loadMeldungen(false);
    }
  }

  private refreshMeldungen(): void {
    if (this.state.mode !== 'meldungen') return;
    this.state.meldungen = { status: 'refreshing', data: this.state.meldungen.data };
    this.loadMeldungen(true);
  }

  /** Ctrl+R: ISR-Daten vollstaendig neu scrapen/bauen/laden (laeuft im Hintergrund). */
  private refreshData(): void {
    if (this.dataRefreshing || !this.opts.onRefreshData) return;
    this.dataRefreshing = true;
    this.state.notice = 'ISR-Daten werden neu gescraped und gebaut … (dauert einige Minuten)';
    this.draw();
    void this.opts.onRefreshData().then((summary) => {
      this.state.notice = 'Daten aktualisiert: ' + summary;
      this.updateResults(); // laufende Suche mit den neuen Daten neu ausfuehren
    }).catch((e) => {
      this.state.notice = 'Daten-Refresh fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e));
    }).finally(() => {
      this.dataRefreshing = false;
      this.draw();
    });
  }

  /** Holt Daten (ggf. erzwungen) und zeichnet neu, wenn die Ansicht noch offen ist. */
  private loadMeldungen(force: boolean): void {
    void this.meldungen.getData(force ? { force: true } : undefined).then((data) => {
      this.state.meldungen = { status: 'ready', data };
      if (this.state.mode === 'meldungen') this.draw();
    }).catch(() => {
      // getData() sollte nie werfen; falls doch, nicht auf loading/refreshing haengen bleiben.
      this.state.meldungen = { status: 'ready', data: this.state.meldungen.data };
      if (this.state.mode === 'meldungen') this.draw();
    });
  }

  private updateResults(): void {
    this.state.results = this.search.search(this.state.query, 500, this.state.filter);
    this.state.sel = 0;
  }

  /** Schaltet den Ergebnistyp-Filter zyklisch weiter (Tab: +1, Shift+Tab: -1). */
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
