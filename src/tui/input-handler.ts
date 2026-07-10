// Translates raw keystrokes into abstract actions. Responsibility: input parsing (SRP).
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
  | { type: 'notices-open' }
  | { type: 'refresh' }
  | { type: 'open-browser' }
  | { type: 'refresh-data' }
  | { type: 'none' };

export class InputHandler {
  /** @param mode current TUI mode (changes the meaning of some keys). */
  parse(key: string, mode: TuiMode): TuiAction {
    if (key === '\x03') return { type: 'quit' }; // Ctrl+C
    if (key === '\x0f') return { type: 'open-browser' }; // Ctrl+O: open the map in the system browser
    if (key === '\x12') return { type: 'refresh-data' };  // Ctrl+R: re-scrape/reload the ISR data (global)

    if (mode === 'notices') {
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
        case '\x1b[A': return { type: 'up' };   // scroll the detail view
        case '\x1b[B': return { type: 'down' };
        default: return { type: 'none' };
      }
    }

    // List/search mode
    switch (key) {
      case '\x02': return { type: 'notices-open' }; // Ctrl+B: network status ("Betriebslage")
      case '\t': return { type: 'filter-next' };   // Tab: next result kind
      case '\x1b[Z': return { type: 'filter-prev' }; // Shift+Tab: previous result kind
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
