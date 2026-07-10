// Selbsttest fuer TUI-Bausteine (ansi.wrap, InputHandler, Renderer).
// Laufbar mit: npx tsx src/tui/tui.selftest.ts
import assert from 'node:assert';
import { wrap } from './ansi.js';
import { InputHandler } from './input-handler.js';
import { TuiRenderer, type TuiState, type MeldungenView } from './tui-renderer.js';
import { stripAnsi } from './ansi.js';
import type { SectionLookup } from '../types.js';

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
  // Modus-Abweisung: Ctrl+B tut in Meldungen nichts, 'r' ist in der Liste nur ein Suchzeichen.
  assert.deepStrictEqual(h.parse('\x02', 'meldungen'), { type: 'none' }, 'Ctrl+B ohne Wirkung in Meldungen');
  assert.deepStrictEqual(h.parse('r', 'list'), { type: 'char', ch: 'r' }, 'r ist Suchzeichen in Liste');
  // Globale Shortcuts (jeder Modus): Ctrl+O Browser, Ctrl+R Daten-Refresh
  assert.deepStrictEqual(h.parse('\x0f', 'list'), { type: 'open-browser' }, 'Ctrl+O -> Browser oeffnen');
  assert.deepStrictEqual(h.parse('\x12', 'list'), { type: 'refresh-data' }, 'Ctrl+R -> Daten-Refresh');
  assert.deepStrictEqual(h.parse('\x0f', 'meldungen'), { type: 'open-browser' }, 'Ctrl+O auch in Meldungen');
  assert.deepStrictEqual(h.parse('\x12', 'detail'), { type: 'refresh-data' }, 'Ctrl+R auch in Detail');
}

// --- Renderer: renderMeldungen ---
{
  const sections: SectionLookup = {
    byLineNumber: () => [],
    byStation: (stel) => stel === 4242
      ? [{ ISR_STRE_NR: 1733, ISR_STRECKE_VON_BIS: 'Uelzen – Langwedel', ISR_KM_VON: '12,3', ISR_KM_BIS: '18,7' }]
      : [],
  };
  const rend = new TuiRenderer(sections);
  const ctx = { url: 'http://x/', requestCount: 0, totalObjects: 0 };

  const baseState = (meldungen: MeldungenView): TuiState => ({
    query: '', results: [], sel: 0, mode: 'meldungen', detailScroll: 0,
    filter: null, meldungen, meldungenScroll: 0, notice: null,
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

  // verortet:true darf KEINEN "ohne Ort"-Marker zeigen
  const dataVerortet = {
    ...data,
    stoerungenListe: [{ key: 'x2', cause: 'Weichenstoerung', subcause: '', text: 'Weiche defekt',
      beginn: '', ende: '', verkehrsarten: ['FV'], gleisEinschraenkung: '', verortet: true }],
  };
  const readyVerortet = stripAnsi(rend.render(baseState({ status: 'ready', data: dataVerortet }), ctx, 100, 24));
  assert.doesNotMatch(readyVerortet, /ohne Ort/, 'verortete Stoerung ohne "ohne Ort"-Marker');

  // refreshing-Status zeigt "Aktualisiere …"
  const refreshing = stripAnsi(rend.render(baseState({ status: 'refreshing', data }), ctx, 100, 24));
  assert.match(refreshing, /Aktualisiere/, 'refreshing-Status zeigt Aktualisiere-Hinweis');

  // error
  const errData = { ...data, error: 'Netzfehler' };
  const err = stripAnsi(rend.render(baseState({ status: 'ready', data: errData }), ctx, 100, 24));
  assert.match(err, /Netzfehler/, 'Fehlertext sichtbar');

  // empty
  const emptyData = { ...data, sammelmeldungen: [], stoerungenListe: [], error: null };
  const empty = stripAnsi(rend.render(baseState({ status: 'ready', data: emptyData }), ctx, 100, 24));
  assert.match(empty, /Keine aktuellen Meldungen/, 'Leer-Hinweis');

  // notice-Statusmeldung wird im Kopf angezeigt (z. B. nach Ctrl+O / Ctrl+R)
  const withNotice: TuiState = { ...baseState({ status: 'ready', data: emptyData }), mode: 'list', notice: 'Karte im Browser geöffnet.' };
  const noticeFrame = stripAnsi(rend.render(withNotice, ctx, 100, 24));
  assert.match(noticeFrame, /Karte im Browser geöffnet/, 'notice im Kopf sichtbar');

  // Betriebsstelle-Detail: zugehoerige Strecken/Abschnitte (via byStation)
  const bstEntry = {
    kind: 'Betriebsstelle' as const, code: 'XY', name: 'Teststelle', detail: '',
    data: { stel: 4242, rl100: 'XY', name: 'Teststelle' },
  };
  const bstState: TuiState = { ...baseState({ status: 'idle', data: null }), mode: 'detail', results: [bstEntry], sel: 0 };
  const bstFrame = stripAnsi(rend.render(bstState, ctx, 100, 24));
  assert.match(bstFrame, /Zugehörige Strecken\/Abschnitte \(1\)/, 'Betriebsstelle: Ueberschrift mit Anzahl');
  assert.match(bstFrame, /1733/, 'Betriebsstelle: Streckennummer sichtbar');
  assert.match(bstFrame, /Uelzen – Langwedel/, 'Betriebsstelle: von-bis sichtbar');
  assert.match(bstFrame, /12,3 → 18,7/, 'Betriebsstelle: km-Bereich sichtbar');
}

console.log('TUI-Teil A+B (wrap, input, renderMeldungen) OK');
