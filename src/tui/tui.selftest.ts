// Selftest for the TUI building blocks (ansi.wrap, InputHandler, renderer).
// Run with: npx tsx src/tui/tui.selftest.ts
import assert from 'node:assert';
import { wrap } from './ansi.js';
import { InputHandler } from './input-handler.js';
import { TuiRenderer, type TuiState, type NoticesView } from './tui-renderer.js';
import { stripAnsi } from './ansi.js';
import type { SectionLookup } from '../types.js';

// --- ansi.wrap ---
{
  assert.deepStrictEqual(wrap('', 10), [''], 'empty text -> one empty line');
  assert.deepStrictEqual(wrap('abc', 10), ['abc'], 'short -> one line');
  const r = wrap('aaa bbb ccc ddd', 7);
  assert.ok(r.every((l) => l.length <= 7), 'every line <= width');
  assert.strictEqual(r.join(' '), 'aaa bbb ccc ddd', 'words are preserved');
  // An overlong single word is cut hard.
  assert.ok(wrap('abcdefghij', 4).every((l) => l.length <= 4), 'long word wrapped hard');
}

// --- InputHandler ---
{
  const h = new InputHandler();
  assert.deepStrictEqual(h.parse('\x02', 'list'), { type: 'notices-open' }, 'Ctrl+B opens the notices');
  assert.deepStrictEqual(h.parse('a', 'list'), { type: 'char', ch: 'a' }, 'letter -> char in the list');
  assert.deepStrictEqual(h.parse('r', 'notices'), { type: 'refresh' }, 'r -> refresh in the notices');
  assert.deepStrictEqual(h.parse('\x1b[A', 'notices'), { type: 'up' }, 'arrow up scrolls the notices');
  assert.deepStrictEqual(h.parse('\x1b', 'notices'), { type: 'back' }, 'Esc -> back from the notices');
  assert.deepStrictEqual(h.parse('q', 'notices'), { type: 'back' }, 'q -> back from the notices');
  assert.deepStrictEqual(h.parse('\r', 'notices'), { type: 'back' }, 'Enter -> back from the notices');
  assert.deepStrictEqual(h.parse('\x03', 'list'), { type: 'quit' }, 'Ctrl+C quits');
  // Detail mode unchanged.
  assert.deepStrictEqual(h.parse('\x1b', 'detail'), { type: 'back' }, 'Esc -> back from detail');
  // Mode rejection: Ctrl+B does nothing in the notices, 'r' is just a search character in the list.
  assert.deepStrictEqual(h.parse('\x02', 'notices'), { type: 'none' }, 'Ctrl+B has no effect in the notices');
  assert.deepStrictEqual(h.parse('r', 'list'), { type: 'char', ch: 'r' }, 'r is a search character in the list');
  // Global shortcuts (every mode): Ctrl+O browser, Ctrl+R data refresh.
  assert.deepStrictEqual(h.parse('\x0f', 'list'), { type: 'open-browser' }, 'Ctrl+O -> open browser');
  assert.deepStrictEqual(h.parse('\x12', 'list'), { type: 'refresh-data' }, 'Ctrl+R -> data refresh');
  assert.deepStrictEqual(h.parse('\x0f', 'notices'), { type: 'open-browser' }, 'Ctrl+O also in the notices');
  assert.deepStrictEqual(h.parse('\x12', 'detail'), { type: 'refresh-data' }, 'Ctrl+R also in detail');
}

// --- Renderer: renderNotices ---
{
  const sections: SectionLookup = {
    byLineNumber: () => [],
    byStation: (stel) => stel === 4242
      ? [{ ISR_STRE_NR: 1733, ISR_STRECKE_VON_BIS: 'Uelzen – Langwedel', ISR_KM_VON: '12,3', ISR_KM_BIS: '18,7' }]
      : [],
  };
  const rend = new TuiRenderer(sections);
  const ctx = { url: 'http://x/', requestCount: 0, totalObjects: 0 };

  const baseState = (notices: NoticesView): TuiState => ({
    query: '', results: [], sel: 0, mode: 'notices', detailScroll: 0,
    filter: null, notices, noticesScroll: 0, notice: null,
  });

  // loading
  const loading = stripAnsi(rend.render(baseState({ status: 'loading', data: null }), ctx, 100, 24));
  assert.match(loading, /Lade Meldungen/, 'loading text');

  // ready with one disruption + one aggregate notice
  const data = {
    disruptions: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    constructionSites: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    lineClosures: { type: 'FeatureCollection' as const, features: [], totalFeatures: 0 },
    aggregateNotices: [{ key: 's1', cause: 'Sammelursache', subcause: '', text: 'Sammeltext',
      start: '', end: '', transportModes: ['FV'] }],
    disruptionNotices: [{ key: 'x1', cause: 'Signalstoerung', subcause: 'Detail', text: 'Kaputtes Signal',
      start: '2026-07-08T10:00:00', end: '', transportModes: ['NV'], trackRestriction: 'SCHWER',
      located: false }],
    generatedAt: '2026-07-08T10:00:00.000Z',
    counts: { disruptions: 0, unlocatedDisruptions: 1, constructionSites: 0, lineClosures: 0, aggregateNotices: 1 },
    error: null,
  };
  const ready = stripAnsi(rend.render(baseState({ status: 'ready', data }), ctx, 100, 24));
  assert.match(ready, /Störungen \(1\)/, 'disruption heading with count');
  assert.match(ready, /Sammelmeldungen \(1\)/, 'aggregate-notice heading with count');
  assert.match(ready, /Signalstoerung/, 'disruption cause visible');
  assert.match(ready, /Kaputtes Signal/, 'disruption text visible');
  assert.match(ready, /ohne Ort/, 'marker for unlocated disruption');

  // located:true must NOT show the "ohne Ort" marker
  const dataLocated = {
    ...data,
    disruptionNotices: [{ key: 'x2', cause: 'Weichenstoerung', subcause: '', text: 'Weiche defekt',
      start: '', end: '', transportModes: ['FV'], trackRestriction: '', located: true }],
  };
  const readyLocated = stripAnsi(rend.render(baseState({ status: 'ready', data: dataLocated }), ctx, 100, 24));
  assert.doesNotMatch(readyLocated, /ohne Ort/, 'located disruption without "ohne Ort" marker');

  // refreshing status shows "Aktualisiere …"
  const refreshing = stripAnsi(rend.render(baseState({ status: 'refreshing', data }), ctx, 100, 24));
  assert.match(refreshing, /Aktualisiere/, 'refreshing status shows the refresh hint');

  // error
  const errData = { ...data, error: 'Netzfehler' };
  const err = stripAnsi(rend.render(baseState({ status: 'ready', data: errData }), ctx, 100, 24));
  assert.match(err, /Netzfehler/, 'error text visible');

  // empty
  const emptyData = { ...data, aggregateNotices: [], disruptionNotices: [], error: null };
  const empty = stripAnsi(rend.render(baseState({ status: 'ready', data: emptyData }), ctx, 100, 24));
  assert.match(empty, /Keine aktuellen Meldungen/, 'empty hint');

  // The transient notice is shown in the header (e.g. after Ctrl+O / Ctrl+R).
  const withNotice: TuiState = { ...baseState({ status: 'ready', data: emptyData }), mode: 'list', notice: 'Karte im Browser geöffnet.' };
  const noticeFrame = stripAnsi(rend.render(withNotice, ctx, 100, 24));
  assert.match(noticeFrame, /Karte im Browser geöffnet/, 'notice visible in the header');

  // Station detail: attached lines/sections (via byStation).
  const stationEntry = {
    kind: 'station' as const, code: 'XY', name: 'Teststelle', detail: '',
    data: { stel: 4242, rl100: 'XY', name: 'Teststelle' },
  };
  const stationState: TuiState = { ...baseState({ status: 'idle', data: null }), mode: 'detail', results: [stationEntry], sel: 0 };
  const stationFrame = stripAnsi(rend.render(stationState, ctx, 100, 24));
  assert.match(stationFrame, /Zugehörige Strecken\/Abschnitte \(1\)/, 'station: heading with count');
  assert.match(stationFrame, /1733/, 'station: line number visible');
  assert.match(stationFrame, /Uelzen – Langwedel/, 'station: from-to visible');
  assert.match(stationFrame, /12,3 → 18,7/, 'station: km range visible');
}

console.log('TUI-Teil A+B (wrap, input, renderMeldungen) OK');
