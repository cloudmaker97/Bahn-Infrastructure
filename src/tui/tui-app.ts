// Orchestriert die TUI: Zustand + stdin + InputHandler + Renderer + Suche.
// Verantwortung: Ablaufsteuerung (SRP); Rendering und Eingabe-Parsing sind ausgelagert.
import { InputHandler } from './input-handler.js';
import { TuiRenderer, FILTER_CYCLE, type TuiContext, type TuiState } from './tui-renderer.js';
import { ESC } from './ansi.js';
import type { EntitySearch } from '../types.js';

export interface TuiAppOptions {
  getContext: () => TuiContext;
  onQuit: () => void;
}

export class TuiApp {
  private state: TuiState = { query: '', results: [], sel: 0, mode: 'list', detailScroll: 0, filter: null };
  private out = process.stdout;

  constructor(
    private search: EntitySearch,
    private renderer: TuiRenderer,
    private input: InputHandler,
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
    const action = this.input.parse(key, this.state.mode === 'detail');
    const s = this.state;
    switch (action.type) {
      case 'quit': this.cleanup(); this.opts.onQuit(); return;
      case 'char': s.query += action.ch; this.updateResults(); break;
      case 'backspace': s.query = s.query.slice(0, -1); this.updateResults(); break;
      case 'clear': s.query = ''; this.updateResults(); break;
      case 'up':
        if (s.mode === 'detail') s.detailScroll = Math.max(0, s.detailScroll - 1);
        else s.sel = Math.max(0, s.sel - 1);
        break;
      case 'down':
        if (s.mode === 'detail') s.detailScroll += 1;
        else s.sel = Math.min(s.results.length - 1, s.sel + 1);
        break;
      case 'enter': if (s.results.length) { s.mode = 'detail'; s.detailScroll = 0; } break;
      case 'back': s.mode = 'list'; break;
      case 'filter-next': this.cycleFilter(1); break;
      case 'filter-prev': this.cycleFilter(-1); break;
      case 'none': return;
    }
    this.draw();
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
