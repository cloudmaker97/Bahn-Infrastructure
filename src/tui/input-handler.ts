// Uebersetzt rohe Tastatureingaben in abstrakte Aktionen. Verantwortung: Eingabe-Parsing (SRP).

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
  | { type: 'none' };

export class InputHandler {
  /** @param inDetail ob gerade die Detailansicht offen ist (aendert Bedeutung mancher Tasten). */
  parse(key: string, inDetail: boolean): TuiAction {
    if (key === '\x03') return { type: 'quit' }; // Ctrl+C

    if (inDetail) {
      switch (key) {
        case '\x1b': case 'q': case '\r': case '\n': return { type: 'back' };
        case '\x1b[A': return { type: 'up' };   // Detailansicht scrollen
        case '\x1b[B': return { type: 'down' };
        default: return { type: 'none' };
      }
    }

    switch (key) {
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
