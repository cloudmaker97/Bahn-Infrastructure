// Uebersetzt rohe Tastatureingaben in abstrakte Aktionen. Verantwortung: Eingabe-Parsing (SRP).
import type { TuiMode } from './tui-renderer.js';

export type TuiAction =
  | { type: 'quit' }
  | { type: 'char'; ch: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'filter-next' }
  | { type: 'filter-prev' }
  | { type: 'meldungen-open' }
  | { type: 'refresh' }
  | { type: 'none' };

export class InputHandler {
  /** @param mode aktueller TUI-Modus (aendert Bedeutung mancher Tasten). */
  parse(key: string, mode: TuiMode): TuiAction {
    if (key === '\x03') return { type: 'quit' }; // Ctrl+C

    if (mode === 'meldungen') {
      switch (key) {
        case '\x1b': case 'q': case '\r': case '\n': return { type: 'back' };
        case '\x1b[A': return { type: 'up' };
        case '\x1b[B': return { type: 'down' };
        case 'r': return { type: 'refresh' };
        default: return { type: 'none' };
      }
    }

    if (mode === 'detail') {
      switch (key) {
        case '\x1b': case 'q': case '\r': case '\n': return { type: 'back' };
        case '\x1b[A': return { type: 'up' };   // Detailansicht scrollen
        case '\x1b[B': return { type: 'down' };
        default: return { type: 'none' };
      }
    }

    // Listen-/Suchmodus
    switch (key) {
      case '\x02': return { type: 'meldungen-open' }; // Ctrl+B: Betriebslage
      case '\t': return { type: 'filter-next' };   // Tab: naechster Ergebnistyp
      case '\x1b[Z': return { type: 'filter-prev' }; // Shift+Tab: vorheriger Ergebnistyp
      case '\x1b[A': return { type: 'up' };
      case '\x1b[B': return { type: 'down' };
      case '\r': case '\n': return { type: 'enter' };
      case '\x7f': case '\x08': return { type: 'backspace' };
      case '\x1b': return { type: 'clear' };
      default:
        if (key >= ' ' && key.length === 1) return { type: 'char', ch: key };
        return { type: 'none' };
    }
  }
}
