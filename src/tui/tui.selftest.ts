// Selbsttest fuer TUI-Bausteine (ansi.wrap, InputHandler, Renderer).
// Laufbar mit: npx tsx src/tui/tui.selftest.ts
import assert from 'node:assert';
import { wrap } from './ansi.js';
import { InputHandler } from './input-handler.js';
import { TuiRenderer, type TuiState, type MeldungenView } from './tui-renderer.js';
import { stripAnsi } from './ansi.js';
import type { AbschnittLookup } from '../types.js';

// --- ansi.wrap ---
{
  assert.deepStrictEqual(wrap('', 10), [''], 'leerer Text -> eine leere Zeile');
  assert.deepStrictEqual(wrap('abc', 10), ['abc'], 'kurz -> eine Zeile');
  const r = wrap('aaa bbb ccc ddd', 7);
  assert.ok(r.every((l) => l.length <= 7), 'jede Zeile <= Breite');
  assert.strictEqual(r.join(' '), 'aaa bbb ccc ddd', 'Worte bleiben erhalten');
  // ueberlanges Einzelwort wird hart geschnitten
  assert.ok(wrap('abcdefghij', 4).every((l) => l.length <= 4), 'langes Wort hart umbrochen');
}

// --- InputHandler ---
{
  const h = new InputHandler();
  assert.deepStrictEqual(h.parse('\x02', 'list'), { type: 'meldungen-open' }, 'Ctrl+B oeffnet Meldungen');
  assert.deepStrictEqual(h.parse('a', 'list'), { type: 'char', ch: 'a' }, 'Buchstabe -> char in Liste');
  assert.deepStrictEqual(h.parse('r', 'meldungen'), { type: 'refresh' }, 'r -> refresh in Meldungen');
  assert.deepStrictEqual(h.parse('\x1b[A', 'meldungen'), { type: 'up' }, 'Pfeil hoch scrollt Meldungen');
  assert.deepStrictEqual(h.parse('\x1b', 'meldungen'), { type: 'back' }, 'Esc -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('q', 'meldungen'), { type: 'back' }, 'q -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('\r', 'meldungen'), { type: 'back' }, 'Enter -> zurueck aus Meldungen');
  assert.deepStrictEqual(h.parse('\x03', 'list'), { type: 'quit' }, 'Ctrl+C beendet');
  // Detailmodus unveraendert
  assert.deepStrictEqual(h.parse('\x1b', 'detail'), { type: 'back' }, 'Esc -> zurueck aus Detail');
}

// --- Renderer: renderMeldungen ---
{
  const abschnitte: AbschnittLookup = { byStrecke: () => [] };
  const rend = new TuiRenderer(abschnitte);
  const ctx = { url: 'http://x/', requestCount: 0, totalObjects: 0 };

  const baseState = (meldungen: MeldungenView): TuiState => ({
    query: '', results: [], sel: 0, mode: 'meldungen', detailScroll: 0,
    filter: null, meldungen, meldungenScroll: 0,
  });

  // loading
  const loading = stripAnsi(rend.render(baseState({ status: 'loading', data: null }), ctx, 100, 24));
  assert.match(loading, /Lade Meldungen/, 'loading-Text');

  // ready mit einer Stoerung + einer Sammelmeldung
  const data = {
    stoerungen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    baustellen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    streckenruhen: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    sammelmeldungen: [{ key: 's1', cause: 'Sammelursache', subcause: '', text: 'Sammeltext',
      beginn: '', ende: '', verkehrsarten: ['FV'] }],
    stoerungenListe: [{ key: 'x1', cause: 'Signalstoerung', subcause: 'Detail', text: 'Kaputtes Signal',
      beginn: '2026-07-08T10:00:00', ende: '', verkehrsarten: ['NV'], gleisEinschraenkung: 'SCHWER',
      verortet: false }],
    generatedAt: '2026-07-08T10:00:00.000Z',
    counts: { stoerungen: 0, stoerungenOhneOrt: 1, baustellen: 0, streckenruhen: 0, sammelmeldungen: 1 },
    error: null,
  };
  const ready = stripAnsi(rend.render(baseState({ status: 'ready', data }), ctx, 100, 24));
  assert.match(ready, /Störungen \(1\)/, 'Stoerungs-Ueberschrift mit Anzahl');
  assert.match(ready, /Sammelmeldungen \(1\)/, 'Sammelmeldungs-Ueberschrift mit Anzahl');
  assert.match(ready, /Signalstoerung/, 'Stoerungs-cause sichtbar');
  assert.match(ready, /Kaputtes Signal/, 'Stoerungs-text sichtbar');
  assert.match(ready, /ohne Ort/, 'Marker fuer nicht verortete Stoerung');

  // error
  const errData = { ...data, error: 'Netzfehler' };
  const err = stripAnsi(rend.render(baseState({ status: 'ready', data: errData }), ctx, 100, 24));
  assert.match(err, /Netzfehler/, 'Fehlertext sichtbar');

  // empty
  const emptyData = { ...data, sammelmeldungen: [], stoerungenListe: [], error: null };
  const empty = stripAnsi(rend.render(baseState({ status: 'ready', data: emptyData }), ctx, 100, 24));
  assert.match(empty, /Keine aktuellen Meldungen/, 'Leer-Hinweis');
}

console.log('TUI-Teil A (wrap, input) OK');
