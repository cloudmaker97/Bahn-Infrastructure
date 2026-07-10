// Selftest for the network-status processing (strecken-info.de).
// 1) OFFLINE: pure functions (coordinates, active filter, GeoJSON build) with fixtures.
// 2) LIVE smoke: real fetch (logging only, no hard asserts).
// Run with: npx tsx src/data/network-status/network-status.selftest.ts
import assert from 'node:assert';
import { mercatorToWgs84, isCurrentlyActive, buildGeoJson } from './transform.js';
import { NetworkStatusService } from './service.js';
import type { CoordResolver, RawNetworkStatus } from './wire.js';
import { IsrData } from '../isr-data.js';
import { AlignmentResolver } from '../../routing/alignment-resolver.js';

// --- 1) mercatorToWgs84 (Ulm, tolerance 0.01 degrees) ---
{
  const [lon, lat] = mercatorToWgs84(1109620.2121808457, 6174406.904287126);
  assert.ok(Math.abs(lon - 9.968) < 0.01, `Ulm lon: ${lon}`);
  // Note: the standard mercator inversion yields lat≈48.40 (Ulm really is at ~48.399).
  // The value 48.32 mentioned in the original task was a typo; 48.40 is mathematically correct.
  assert.ok(Math.abs(lat - 48.40) < 0.01, `Ulm lat: ${lat}`);
  // GeoJSON order is [lon, lat].
  assert.ok(lon < lat, 'order must be [lon, lat]');
}

// --- 2) isCurrentlyActive ---
{
  // Window that covers NOW (normal window within one day).
  const now = new Date(2026, 6, 6, 15, 0, 0); // Monday 15:00
  const covering = {
    gueltigkeiten: [
      {
        vonDatum: '2026-01-01',
        bisDatum: '2026-12-31',
        wochentage: ['MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG', 'SONNTAG'],
        vonUhrzeit: '08:00:00',
        bisUhrzeit: '18:00:00',
      },
    ],
  };
  assert.strictEqual(isCurrentlyActive(covering, now), true, 'covering window -> true');

  // Window across midnight (20:00-04:00).
  const acrossMidnight = {
    gueltigkeiten: [
      {
        vonDatum: '2026-01-01',
        bisDatum: '2026-12-31',
        wochentage: ['MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG', 'SONNTAG'],
        vonUhrzeit: '20:00:00',
        bisUhrzeit: '04:00:00',
      },
    ],
  };
  assert.strictEqual(
    isCurrentlyActive(acrossMidnight, new Date(2026, 6, 6, 23, 0, 0)),
    true,
    'across midnight at 23:00 -> true',
  );
  assert.strictEqual(
    isCurrentlyActive(acrossMidnight, new Date(2026, 6, 6, 12, 0, 0)),
    false,
    'across midnight at 12:00 -> false',
  );

  // Disruption: abgelaufen=true -> false.
  const expired = {
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    abgelaufen: true,
    geschlossen: false,
  };
  assert.strictEqual(isCurrentlyActive(expired, now), false, 'expired -> false');

  // Disruption: now within the period -> true.
  const running = {
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    abgelaufen: false,
    geschlossen: false,
  };
  assert.strictEqual(isCurrentlyActive(running, now), true, 'now within the period -> true');
}

// --- 3) buildGeoJson with real (trimmed) response fixtures ---
{
  // Disruption (located, koordinaten = line of 2 points).
  const disruption = {
    key: 'BZI_00055',
    cause: 'Störung am Fahrweg',
    subcause: 'Hindernis im/am Gleis',
    text: 'Dachsbau unter dem Gleisbett.',
    wirkungenMitVerkehrsarten: [
      { wirkung: 'AUSFALL', verkehrsarten: ['SPNV'] },
      { wirkung: 'UMLEITUNG', verkehrsarten: ['SGV'] },
    ],
    gleisEinschraenkung: 'SCHWER',
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    koordinaten: [
      { x: 860192.1231000547, y: 6706885.417225196 },
      { x: 859652.3850608926, y: 6716452.06501565 },
    ],
    sammelmeldung: false,
    geschlossen: false,
    abgelaufen: false,
  };

  // Aggregate notice (sammelmeldung=true, empty koordinaten) -> must NOT end up in disruptions.
  const aggregate = {
    key: 'BZI_28777',
    cause: 'Sonstige Unregelmäßigkeit',
    subcause: '',
    text: 'Infolge von Kapazitätseinschränkungen ...',
    wirkungenMitVerkehrsarten: [{ wirkung: 'SONSTIGES', verkehrsarten: ['SGV'] }],
    gleisEinschraenkung: 'LEICHT',
    zeitraum: { beginn: '2026-07-03T21:40:31', ende: '2026-07-12T23:59:59' },
    koordinaten: [],
    sammelmeldung: true,
    geschlossen: false,
    abgelaufen: false,
  };

  // Construction site (koordinaten = from/to segment, here from==to -> Point expected).
  const constructionSite = {
    streckennummern: [4541],
    richtung: 'GEGEN_KILOMETRIERUNG',
    regionen: ['SUEDWEST'],
    baustellenID: '205A7.2',
    wirkung: 'ABWEICHUNG_VOM_FPL',
    gleisEinschraenkung: 'LEICHT',
    arbeiten: 'Brückenarbeiten',
    zeitraum: { beginn: '2026-01-16T21:00:00', ende: '2026-09-05T04:00:00' },
    gueltigkeiten: [
      {
        vonDatum: '2026-01-16',
        bisDatum: '2026-09-05',
        wochentage: ['MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG', 'SONNTAG'],
        vonUhrzeit: '21:00:00',
        bisUhrzeit: '04:00:00',
      },
    ],
    langnameVon: 'Ulm Hbf Bft Rbf',
    langnameBis: 'Ulm Hbf Bft Rbf',
    ril100Von: 'TU  R',
    ril100Bis: 'TU  R',
    koordinaten: {
      von: { x: 1109620.2121808457, y: 6174406.904287126 },
      bis: { x: 1109620.2121808457, y: 6174406.904287126 },
    },
  };

  // Disruption WITHOUT koordinaten, located via `abschnitte` (RL100 -> fake resolver).
  const disruptionViaSection = {
    key: 'BZI_ABS',
    cause: 'Störung am Fahrweg',
    subcause: '',
    text: 'Verortung ueber Abschnitt.',
    wirkungenMitVerkehrsarten: [{ wirkung: 'AUSFALL', verkehrsarten: ['SPNV'] }],
    gleisEinschraenkung: 'SCHWER',
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    koordinaten: [],
    abschnitte: [
      {
        von: { ril100: 'EEK', langname: 'Erndtebrück' },
        bis: { ril100: 'EBLB', langname: 'Bad Berleburg' },
        streckennummer: 2871,
      },
    ],
    betriebsstellen: [],
    sammelmeldung: false,
    geschlossen: false,
    abgelaufen: false,
  };

  // Disruption WITHOUT any locatable geometry -> geometry null, counted as unlocated.
  const disruptionUnlocated = {
    key: 'BZI_NIX',
    cause: 'Sonstige Unregelmäßigkeit',
    subcause: '',
    text: 'Keine Geometrie.',
    wirkungenMitVerkehrsarten: [],
    gleisEinschraenkung: 'LEICHT',
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    koordinaten: [],
    abschnitte: [],
    betriebsstellen: [],
    sammelmeldung: false,
    geschlossen: false,
    abgelaufen: false,
  };

  // Line closure (koordinaten = point; Mon-Thu, 20:00-04:00).
  const lineClosure = {
    streckenruhenId: 'RUHE000000000006',
    ril100: 'FPAP',
    bstLangname: 'Papierfabrik',
    koordinaten: { x: 1064979.385470093, y: 6672759.787328582 },
    gueltigkeiten: [
      {
        vonDatum: '2026-01-26',
        bisDatum: '2026-12-10',
        wochentage: ['MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG'],
        vonUhrzeit: '20:00:00',
        bisUhrzeit: '04:00:00',
      },
    ],
    streckennummer: 1234,
    region: 'OST',
    arbeiten: 'Bauarbeiten',
    zeitraum: { beginn: '2026-01-22T00:00:00', ende: '2026-12-11T05:20:00' },
  };

  // Fake resolver (in-memory map ril100 -> [lon, lat]).
  const fakeCoords = new Map<string, [number, number]>([
    ['EEK', [8.0, 50.9]],
    ['EBLB', [8.4, 51.0]],
  ]);
  const resolveCoord: CoordResolver = (ril100) => fakeCoords.get(ril100.trim()) ?? null;

  // now = Monday 2026-07-06 22:00 -> covers the construction and closure windows.
  const now = new Date(2026, 6, 6, 22, 0, 0);
  const raw: RawNetworkStatus = {
    stoerungen: [disruption, aggregate, disruptionViaSection, disruptionUnlocated],
    baustellen: [constructionSite],
    streckenruhen: [lineClosure],
    sammelmeldungen: [aggregate],
  };
  const r = buildGeoJson(raw, now, resolveCoord);

  // Disruptions: 2 located (koordinaten + abschnitte); aggregate + unlocated NOT included.
  assert.strictEqual(r.disruptions.features.length, 2, `disruptions: ${r.disruptions.features.length}`);
  const sf = r.disruptions.features[0]!;
  assert.strictEqual(sf.properties.category, 'disruption', 'category disruption');
  assert.strictEqual(sf.geometry!.type, 'LineString', 'disruption -> LineString');
  const coords = sf.geometry!.coordinates as [number, number][];
  assert.strictEqual(coords.length, 2, 'LineString with 2 points');
  for (const [lon, lat] of coords) {
    assert.ok(lon > 5 && lon < 16, `lon in DE: ${lon}`);
    assert.ok(lat > 47 && lat < 56, `lat in DE: ${lat}`);
  }

  // Section-located disruption: LineString from 2 resolved RL100 ends.
  const sectionFeat = r.disruptions.features.find((f) => f.properties.key === 'BZI_ABS');
  assert.ok(sectionFeat, 'section-located disruption must be located');
  assert.strictEqual(sectionFeat!.geometry!.type, 'LineString', 'section -> LineString');
  const sectionCoords = sectionFeat!.geometry!.coordinates as [number, number][];
  assert.strictEqual(sectionCoords.length, 2, 'section LineString with 2 points');
  assert.deepStrictEqual(sectionCoords, [
    [8.0, 50.9],
    [8.4, 51.0],
  ]);
  for (const [lon, lat] of sectionCoords) {
    assert.ok(lon > 5 && lon < 16, `section lon in DE: ${lon}`);
    assert.ok(lat > 47 && lat < 56, `section lat in DE: ${lat}`);
  }

  // The aggregate notice is NOT in disruptions.
  assert.ok(
    !r.disruptions.features.some((f) => f.properties.key === 'BZI_28777'),
    'aggregate notice must not be in disruptions',
  );
  // The unlocatable disruption is NOT in features, but counted in unlocatedDisruptions.
  assert.ok(
    !r.disruptions.features.some((f) => f.properties.key === 'BZI_NIX'),
    'unlocated disruption must not be in features',
  );
  assert.strictEqual(r.counts.unlocatedDisruptions, 1, `unlocatedDisruptions: ${r.counts.unlocatedDisruptions}`);

  // Construction site present (from==to -> Point).
  assert.strictEqual(r.constructionSites.features.length, 1, `constructionSites: ${r.constructionSites.features.length}`);
  assert.strictEqual(r.constructionSites.features[0]!.properties.category, 'construction');
  assert.strictEqual(r.constructionSites.features[0]!.geometry!.type, 'Point', 'from==to -> Point');

  // Line closure present.
  assert.strictEqual(r.lineClosures.features.length, 1, `lineClosures: ${r.lineClosures.features.length}`);
  assert.strictEqual(r.lineClosures.features[0]!.geometry!.type, 'Point', 'line closure -> Point');

  // The aggregate-notice list contains the notice (with deduplicated transport modes).
  assert.strictEqual(r.aggregateNotices.length, 1, `aggregateNotices: ${r.aggregateNotices.length}`);
  assert.strictEqual(r.aggregateNotices[0]!.key, 'BZI_28777');
  assert.deepStrictEqual(r.aggregateNotices[0]!.transportModes, ['SGV']);

  // counts consistent.
  assert.deepStrictEqual(r.counts, {
    disruptions: 2,
    unlocatedDisruptions: 1,
    constructionSites: 1,
    lineClosures: 1,
    aggregateNotices: 1,
  });
}

// --- disruptionNotices: located + unlocated disruptions ---
{
  const now = new Date(2026, 6, 6, 12, 0, 0); // Monday 12:00, active
  const zeitraum = { beginn: '2026-07-01T00:00:00', ende: '2026-12-31T23:59:59' };
  const resolve: CoordResolver = (r) => (r === 'AA' ? [9.9, 48.4] : null);
  const raw: RawNetworkStatus = {
    stoerungen: [
      { key: 'v', cause: 'Signalstoerung', subcause: 'x', text: 'verortet',
        zeitraum, betriebsstellen: [{ ril100: 'AA' }],
        wirkungenMitVerkehrsarten: [{ wirkung: 'Sperrung', verkehrsarten: ['FV', 'NV'] }] },
      { key: 'o', cause: 'Oberleitung', subcause: 'y', text: 'ohne Ort',
        zeitraum, gleisEinschraenkung: 'SCHWER' }, // no geo source -> not locatable
      { key: 's', cause: 'Sonstige Unregelmäßigkeit', subcause: '', text: 'Sammelmeldung',
        zeitraum, sammelmeldung: true }, // aggregate -> must NOT end up in disruptionNotices
    ],
    baustellen: [],
    streckenruhen: [],
    sammelmeldungen: [],
  };

  const r = buildGeoJson(raw, now, resolve);

  assert.strictEqual(r.disruptions.features.length, 1, 'only located ones in features');
  assert.strictEqual(r.disruptionNotices.length, 2, 'only non-aggregates in disruptionNotices');
  const located = r.disruptionNotices.find((m) => m.key === 'v');
  const unlocated = r.disruptionNotices.find((m) => m.key === 'o');
  assert.ok(located && located.located === true, 'v is located');
  assert.deepStrictEqual(located!.transportModes.sort(), ['FV', 'NV'], 'transport modes flattened');
  assert.ok(unlocated && unlocated.located === false, 'o is not located');
  assert.strictEqual(unlocated!.trackRestriction, 'SCHWER', 'trackRestriction carried over');
  assert.strictEqual(r.counts.unlocatedDisruptions, 1, 'unlocated counter unchanged');
  assert.ok(
    !r.disruptionNotices.some((m) => m.key === 's'),
    'aggregate (sammelmeldung:true) must not be in disruptionNotices',
  );
}

// --- Alignment instead of straight line (resolveAlignment): disruption sections + construction ---
{
  const now = new Date(2026, 6, 6, 12, 0, 0); // Monday 12:00
  const zeitraum = { beginn: '2026-07-01T00:00:00', ende: '2026-12-31T23:59:59' };
  const fakeCoords = new Map<string, [number, number]>([
    ['EEK', [8.0, 50.9]],
    ['EBLB', [8.4, 51.0]],
    ['XAA', [9.0, 49.0]],
    ['XBB', [9.5, 49.2]],
  ]);
  const resolveCoord: CoordResolver = (ril100) => fakeCoords.get(ril100.trim()) ?? null;
  // Fake alignment: knows only EEK<->EBLB (3 points); the direction must match.
  const alignmentCalls: Array<[string, string, number[] | undefined]> = [];
  const resolveAlignment = (from: string, to: string, lines?: number[]): [number, number][] | null => {
    alignmentCalls.push([from, to, lines]);
    if (from === 'EEK' && to === 'EBLB') return [[8.0, 50.9], [8.2, 50.95], [8.4, 51.0]];
    if (from === 'EBLB' && to === 'EEK') return [[8.4, 51.0], [8.2, 50.95], [8.0, 50.9]];
    // Sub-station code that resolveCoord does NOT know (the real resolver
    // resolves it via the base operating point).
    if (from === 'EEK Q' && to === 'EBLB') return [[8.01, 50.91], [8.2, 50.95], [8.4, 51.0]];
    return null;
  };

  // Disruption with forward AND backward direction (as in real data) -> ONE routed segment.
  const disruptionBothWays = {
    key: 'BZI_DUP',
    cause: 'Störung am Fahrweg', subcause: '', text: 'Hin+Rueck.',
    zeitraum,
    abschnitte: [
      { von: { ril100: 'EEK' }, bis: { ril100: 'EBLB' }, streckennummer: 2871 },
      { von: { ril100: 'EBLB' }, bis: { ril100: 'EEK' }, streckennummer: 2871 },
    ],
  };
  // Disruption whose alignment is NOT resolvable -> straight line (2 points) stays.
  const disruptionFallback = {
    key: 'BZI_FALLBACK',
    cause: 'Störung am Fahrweg', subcause: '', text: 'Fallback.',
    zeitraum,
    abschnitte: [{ von: { ril100: 'XAA' }, bis: { ril100: 'XBB' }, streckennummer: 1 }],
  };
  // Construction from!=to with both RIL100 -> routed alignment.
  const constructionRouted = {
    baustellenID: 'B_VERLAUF', arbeiten: 'Gleisbau', zeitraum,
    streckennummern: [2871],
    ril100Von: 'EEK', ril100Bis: 'EBLB',
    koordinaten: {
      von: { x: 890000, y: 6600000 },
      bis: { x: 935000, y: 6620000 },
    },
  };
  // Construction whose alignment is not resolvable -> straight line (2 points).
  const constructionFallback = {
    baustellenID: 'B_FALLBACK', arbeiten: 'Gleisbau', zeitraum,
    ril100Von: 'XAA', ril100Bis: 'XBB',
    koordinaten: {
      von: { x: 1000000, y: 6300000 },
      bis: { x: 1060000, y: 6330000 },
    },
  };

  const r = buildGeoJson(
    {
      stoerungen: [disruptionBothWays, disruptionFallback],
      baustellen: [constructionRouted, constructionFallback],
      streckenruhen: [], sammelmeldungen: [],
    },
    now, resolveCoord, resolveAlignment,
  );

  // Forward+backward deduplicated -> ONE LineString with the routed 3-point chain.
  const dup = r.disruptions.features.find((f) => f.properties.key === 'BZI_DUP')!;
  assert.ok(dup, 'BZI_DUP located');
  assert.strictEqual(dup.geometry!.type, 'LineString', 'forward+backward -> ONE segment (deduplicated)');
  assert.deepStrictEqual(dup.geometry!.coordinates, [[8.0, 50.9], [8.2, 50.95], [8.4, 51.0]]);
  // The line number is passed through to the resolver.
  assert.deepStrictEqual(alignmentCalls[0], ['EEK', 'EBLB', [2871]], 'line number passed through');

  // Sub-station end ("EEK Q"): resolveCoord does not know it, but the alignment
  // attempt must still happen (the gate is the RIL codes, not resolveCoord).
  const disruptionSubStation = {
    key: 'BZI_BFT',
    cause: 'Störung am Fahrweg', subcause: '', text: 'Bft-Ende.',
    zeitraum,
    abschnitte: [{ von: { ril100: 'EEK Q' }, bis: { ril100: 'EBLB' }, streckennummer: 2871 }],
  };
  const rSub = buildGeoJson(
    { stoerungen: [disruptionSubStation], baustellen: [], streckenruhen: [], sammelmeldungen: [] },
    now, resolveCoord, resolveAlignment,
  );
  const sub = rSub.disruptions.features.find((f) => f.properties.key === 'BZI_BFT')!;
  assert.ok(sub, 'BZI_BFT located');
  assert.strictEqual(sub.geometry!.type, 'LineString', 'sub-station section is routed instead of a point');
  assert.strictEqual((sub.geometry!.coordinates as unknown[]).length, 3);

  // Unresolvable alignment -> straight line as before.
  const fb = r.disruptions.features.find((f) => f.properties.key === 'BZI_FALLBACK')!;
  assert.strictEqual(fb.geometry!.type, 'LineString');
  assert.deepStrictEqual(fb.geometry!.coordinates, [[9.0, 49.0], [9.5, 49.2]], 'fallback = straight line');

  // Construction with alignment -> routed chain; without -> straight line from mercator coordinates.
  const bv = r.constructionSites.features.find((f) => f.properties.id === 'B_VERLAUF')!;
  assert.strictEqual(bv.geometry!.type, 'LineString');
  assert.strictEqual((bv.geometry!.coordinates as unknown[]).length, 3, 'construction routed (3 points)');
  const bf = r.constructionSites.features.find((f) => f.properties.id === 'B_FALLBACK')!;
  assert.strictEqual(bf.geometry!.type, 'LineString');
  assert.strictEqual((bf.geometry!.coordinates as unknown[]).length, 2, 'construction fallback = straight line');

  // Construction from==to stays a point, even with a resolver.
  const constructionPoint = {
    baustellenID: 'B_PUNKT', arbeiten: 'x', zeitraum,
    ril100Von: 'EEK', ril100Bis: 'EBLB',
    koordinaten: { von: { x: 890000, y: 6600000 }, bis: { x: 890000, y: 6600000 } },
  };
  const r2 = buildGeoJson(
    { stoerungen: [], baustellen: [constructionPoint], streckenruhen: [], sammelmeldungen: [] },
    now, resolveCoord, resolveAlignment,
  );
  assert.strictEqual(r2.constructionSites.features[0]!.geometry!.type, 'Point', 'from==to stays a point');

  // --- 2-point koordinaten (straight line) with routable sections: the track alignment wins ---
  {
    // Direct 2-point koordinaten ARE themselves a straight line. When the sections
    // yield a track-accurate alignment, it must beat the straight line (core of the fix).
    const disruptionCoordsAndAlignment = {
      key: 'BZI_KOORD_VERLAUF',
      cause: 'Störung am Fahrweg', subcause: '', text: 'koordinaten + routbare abschnitte.',
      zeitraum,
      koordinaten: [
        { x: 890000, y: 6600000 },
        { x: 935000, y: 6620000 },
      ],
      abschnitte: [{ von: { ril100: 'EEK' }, bis: { ril100: 'EBLB' }, streckennummer: 2871 }],
    };
    // 2-point koordinaten with sections that do NOT route -> the koordinaten stay (no regression).
    const disruptionCoordsNoAlignment = {
      key: 'BZI_KOORD_FALLBACK',
      cause: 'Störung am Fahrweg', subcause: '', text: 'koordinaten + nicht routbare abschnitte.',
      zeitraum,
      koordinaten: [
        { x: 1000000, y: 6300000 },
        { x: 1060000, y: 6330000 },
      ],
      abschnitte: [{ von: { ril100: 'XAA' }, bis: { ril100: 'XBB' }, streckennummer: 1 }],
    };
    const rk = buildGeoJson(
      {
        stoerungen: [disruptionCoordsAndAlignment, disruptionCoordsNoAlignment],
        baustellen: [], streckenruhen: [], sammelmeldungen: [],
      },
      now, resolveCoord, resolveAlignment,
    );
    const kv = rk.disruptions.features.find((f) => f.properties.key === 'BZI_KOORD_VERLAUF')!;
    assert.ok(kv, 'BZI_KOORD_VERLAUF located');
    assert.strictEqual(kv.geometry!.type, 'LineString', 'routed alignment beats the 2-point koordinaten');
    assert.deepStrictEqual(
      kv.geometry!.coordinates,
      [[8.0, 50.9], [8.2, 50.95], [8.4, 51.0]],
      'track chain instead of the 2-point straight line',
    );
    // Not routable -> the direct koordinaten (straight line) are kept.
    const kf = rk.disruptions.features.find((f) => f.properties.key === 'BZI_KOORD_FALLBACK')!;
    assert.strictEqual(kf.geometry!.type, 'LineString');
    assert.strictEqual(
      (kf.geometry!.coordinates as unknown[]).length,
      2,
      'without alignment: the koordinaten straight line stays',
    );
  }
}

console.log('SELFTEST OK');

// --- 4) LIVE smoke (network + real ISR data): log counts, alignment routing + duration ---
{
  try {
    // Load real operating points + graph: tests RL100 geocoding AND alignment routing for real.
    const data = new IsrData();
    const resolver = new AlignmentResolver(data.graph, data.stations);
    const t0 = Date.now();
    const r = await new NetworkStatusService(data.stations, { alignment: resolver.resolve }).getData();
    console.log(`LIVE duration incl. alignment routing: ${Date.now() - t0} ms`);
    console.log('LIVE counts:', JSON.stringify(r.counts));
    const located = r.counts.disruptions;
    const total = r.counts.disruptions + r.counts.unlocatedDisruptions;
    console.log(`LIVE disruptions located: ${located}/${total}`);
    // How many lines follow the track (>2 points) instead of the straight line (==2)?
    const lineStats = (fc: { features: Array<{ geometry: { type: string; coordinates: unknown } | null }> }) => {
      let routed = 0, straight = 0;
      for (const f of fc.features) {
        const g = f.geometry;
        const segs = g?.type === 'LineString' ? [g.coordinates as unknown[]]
          : g?.type === 'MultiLineString' ? (g.coordinates as unknown[][]) : [];
        for (const s of segs) (s.length > 2 ? routed++ : straight++);
      }
      return `${routed} routed / ${straight} straight`;
    };
    console.log(`LIVE disruption lines: ${lineStats(r.disruptions)}`);
    console.log(`LIVE construction lines: ${lineStats(r.constructionSites)}`);
    if (r.error != null) console.warn('LIVE WARNING error:', r.error);
    else console.log('LIVE error: null');
  } catch (e) {
    // getData() should never throw; if it does anyway, only warn.
    console.warn('LIVE threw unexpectedly:', e instanceof Error ? e.message : String(e));
  }
}

// --- LIVE smoke: force + onRefresh (logging only) ---
// IsrData construction in try/catch: in CI the (gitignored) data files are missing,
// then the GraphBuilder throws -> skip this block cleanly instead of aborting the run.
try {
  const isr = new IsrData();
  let refreshed = 0;
  const svc = new NetworkStatusService(isr.stations, { onRefresh: () => { refreshed++; } });
  const first = await svc.getData();             // 1st real scrape (errors go to the error field, no throw)
  if (first.error) {
    console.log('[live] skipped (no network):', first.error);
  } else {
    await svc.getData();                          // cache hit -> refreshed unchanged
    await svc.getData({ force: true });           // forced -> refreshed++
    console.log(`[live] onRefresh calls (expected 2): ${refreshed}`);
  }
} catch (e) {
  console.log('[live] skipped (no ISR data):', e instanceof Error ? e.message : String(e));
}
