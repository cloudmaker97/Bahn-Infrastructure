// Zustandslose ANSI-Hilfsfunktionen fuer die TUI.
import type { SearchEntry } from '../types.js';

export const ESC = '\x1b';
export const c = (code: string, s: string): string => `${ESC}[${code}m${s}${ESC}[0m`;
export const bold = (s: string): string => c('1', s);
export const dim = (s: string): string => c('2', s);
export const inv = (s: string): string => c('7', s);

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
export const visLen = (s: string): number => stripAnsi(s).length;

export const KIND_COLOR: Record<SearchEntry['kind'], string> = {
  'Betriebsstelle': '36', 'Strecke': '33', 'Tunnel': '35', 'Brücke': '32', 'Bahnübergang': '90',
};

/** Fuellt/kuerzt auf sichtbare Breite (ANSI-Codes zaehlen nicht). */
export function pad(s: string, width: number): string {
  const len = visLen(s);
  if (len > width) return stripAnsi(s).slice(0, Math.max(0, width - 1)) + '…';
  return s + ' '.repeat(width - len);
}
