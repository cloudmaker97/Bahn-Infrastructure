// Stateless ANSI helpers for the TUI.
import type { SearchEntryKind } from '../types.js';

export const ESC = '\x1b';
export const c = (code: string, s: string): string => `${ESC}[${code}m${s}${ESC}[0m`;
export const bold = (s: string): string => c('1', s);
export const dim = (s: string): string => c('2', s);
export const inv = (s: string): string => c('7', s);

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
export const visLen = (s: string): number => stripAnsi(s).length;

export const KIND_COLOR: Record<SearchEntryKind, string> = {
  station: '36', line: '33', tunnel: '35', bridge: '32', 'level-crossing': '90',
};

/** German display labels of the search-entry kinds (UI language stays German). */
export const KIND_LABEL: Record<SearchEntryKind, string> = {
  station: 'Betriebsstelle', line: 'Strecke', tunnel: 'Tunnel', bridge: 'Brücke', 'level-crossing': 'Bahnübergang',
};

/** Pads/truncates to the visible width (ANSI codes do not count). */
export function pad(s: string, width: number): string {
  const len = visLen(s);
  if (len > width) return stripAnsi(s).slice(0, Math.max(0, width - 1)) + '…';
  return s + ' '.repeat(width - len);
}

/**
 * Word wrap to the visible width. Input WITHOUT ANSI codes.
 * Overlong single words are cut hard. Empty text -> [''].
 */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const rawLine of String(text).split('\n')) {
    let line = '';
    for (const word of rawLine.split(/\s+/).filter((x) => x.length > 0)) {
      let word2 = word;
      while (word2.length > w) {
        // Word longer than the line: cut off the rest hard.
        if (line) { out.push(line); line = ''; }
        out.push(word2.slice(0, w));
        word2 = word2.slice(w);
      }
      if (!line) line = word2;
      else if (line.length + 1 + word2.length <= w) line += ' ' + word2;
      else { out.push(line); line = word2; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}
