// Selbsttest fuer die strecken-info-Aufbereitung.
// 1) OFFLINE: reine Funktionen (Koordinaten, Aktiv-Filter, GeoJSON-Bau) mit Fixtures.
// 2) LIVE-Smoke: echter Abruf (nur Logging, kein harter Assert).
// Laufbar mit: npx tsx src/data/streckeninfo.selftest.ts
import assert from 'node:assert';
import {
  mercatorToWgs84,
  istAktuellAktiv,
  baueGeoJson,
  StreckenInfoService,
  type StreckenInfoRohdaten,
  type CoordResolver,
} from './streckeninfo.js';
import { IsrData } from './isr-data.js';

// --- 1) mercatorToWgs84 (Ulm, Toleranz 0.01 Grad) ---
{
  const [lon, lat] = mercatorToWgs84(1109620.2121808457, 6174406.904287126);
  assert.ok(Math.abs(lon - 9.968) < 0.01, `Ulm lon: ${lon}`);
  // Hinweis: Die Standard-Mercator-Umkehrung liefert lat≈48.40 (echte Lage von Ulm ~48.399).
  // Der im Auftrag genannte Wert 48.32 ist ein Tippfehler; 48.40 ist mathematisch korrekt.
  assert.ok(Math.abs(lat - 48.40) < 0.01, `Ulm lat: ${lat}`);
  // GeoJSON-Reihenfolge ist [lon, lat].
  assert.ok(lon < lat, 'Reihenfolge muss [lon, lat] sein');
}

// --- 2) istAktuellAktiv ---
{
  // Fenster, das JETZT abdeckt (normales Fenster innerhalb eines Tages).
  const now = new Date(2026, 6, 6, 15, 0, 0); // Montag 15:00
  const abdeckend = {
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
  assert.strictEqual(istAktuellAktiv(abdeckend, now), true, 'abdeckendes Fenster -> true');

  // Fenster ueber Mitternacht (20:00-04:00).
  const ueberMitternacht = {
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
    istAktuellAktiv(ueberMitternacht, new Date(2026, 6, 6, 23, 0, 0)),
    true,
    'ueber Mitternacht um 23:00 -> true',
  );
  assert.strictEqual(
    istAktuellAktiv(ueberMitternacht, new Date(2026, 6, 6, 12, 0, 0)),
    false,
    'ueber Mitternacht um 12:00 -> false',
  );

  // Stoerung: abgelaufen=true -> false.
  const abgelaufen = {
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    abgelaufen: true,
    geschlossen: false,
  };
  assert.strictEqual(istAktuellAktiv(abgelaufen, now), false, 'abgelaufen -> false');

  // Stoerung: now im Zeitraum -> true.
  const laufend = {
    zeitraum: { beginn: '2023-08-01T00:00:11', ende: '2026-12-12T23:59:59' },
    abgelaufen: false,
    geschlossen: false,
  };
  assert.strictEqual(istAktuellAktiv(laufend, now), true, 'now im Zeitraum -> true');
}

// --- 3) baueGeoJson mit echten (getrimmten) Response-Fixtures ---
{
  // Stoerung (verortet, koordinaten = Linie aus 2 Punkten).
  const stoerung = {
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

  // Sammelmeldung (sammelmeldung=true, koordinaten leer) -> darf NICHT in stoerungen landen.
  const sammel = {
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

  // Baustelle (koordinaten = Segment von/bis, hier von==bis -> Point erwartet).
  const baustelle = {
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

  // Stoerung OHNE koordinaten, verortet ueber `abschnitte` (RL100 -> Fake-Resolver).
  const stoerungAbschnitt = {
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

  // Stoerung OHNE jegliche verortbare Geometrie -> geometry null, zaehlt als "ohne Ort".
  const stoerungOhneOrt = {
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

  // Streckenruhe (koordinaten = Punkt; Mo-Do, 20:00-04:00).
  const streckenruhe = {
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

  // Fake-Resolver (in-memory Map ril100 -> [lon, lat]).
  const fakeCoords = new Map<string, [number, number]>([
    ['EEK', [8.0, 50.9]],
    ['EBLB', [8.4, 51.0]],
  ]);
  const resolveCoord: CoordResolver = (ril100) => fakeCoords.get(ril100.trim()) ?? null;

  // now = Montag 2026-07-06 22:00 -> deckt Baustellen- und Streckenruhen-Fenster ab.
  const now = new Date(2026, 6, 6, 22, 0, 0);
  const rohdaten: StreckenInfoRohdaten = {
    stoerungen: [stoerung, sammel, stoerungAbschnitt, stoerungOhneOrt],
    baustellen: [baustelle],
    streckenruhen: [streckenruhe],
    sammelmeldungen: [sammel],
  };
  const r = baueGeoJson(rohdaten, now, resolveCoord);

  // Stoerungen: 2 verortete (koordinaten + abschnitte); Sammelmeldung + ohne-Ort NICHT dabei.
  assert.strictEqual(r.stoerungen.features.length, 2, `stoerungen: ${r.stoerungen.features.length}`);
  const sf = r.stoerungen.features[0]!;
  assert.strictEqual(sf.properties.kategorie, 'stoerung', 'kategorie stoerung');
  assert.strictEqual(sf.geometry!.type, 'LineString', 'stoerung -> LineString');
  const coords = sf.geometry!.coordinates as [number, number][];
  assert.strictEqual(coords.length, 2, 'LineString mit 2 Punkten');
  for (const [lon, lat] of coords) {
    assert.ok(lon > 5 && lon < 16, `lon in DE: ${lon}`);
    assert.ok(lat > 47 && lat < 56, `lat in DE: ${lat}`);
  }

  // Abschnitts-verortete Stoerung: LineString aus 2 aufgeloesten RL100-Enden.
  const abschnittFeat = r.stoerungen.features.find((f) => f.properties.key === 'BZI_ABS');
  assert.ok(abschnittFeat, 'Abschnitts-Stoerung muss verortet sein');
  assert.strictEqual(abschnittFeat!.geometry!.type, 'LineString', 'Abschnitt -> LineString');
  const absCoords = abschnittFeat!.geometry!.coordinates as [number, number][];
  assert.strictEqual(absCoords.length, 2, 'Abschnitt-LineString mit 2 Punkten');
  assert.deepStrictEqual(absCoords, [
    [8.0, 50.9],
    [8.4, 51.0],
  ]);
  for (const [lon, lat] of absCoords) {
    assert.ok(lon > 5 && lon < 16, `abs lon in DE: ${lon}`);
    assert.ok(lat > 47 && lat < 56, `abs lat in DE: ${lat}`);
  }

  // Sammelmeldung NICHT in stoerungen.
  assert.ok(
    !r.stoerungen.features.some((f) => f.properties.key === 'BZI_28777'),
    'Sammelmeldung darf nicht in stoerungen sein',
  );
  // Nicht-verortbare Stoerung NICHT in features, aber in stoerungenOhneOrt gezaehlt.
  assert.ok(
    !r.stoerungen.features.some((f) => f.properties.key === 'BZI_NIX'),
    'Stoerung ohne Ort darf nicht in features sein',
  );
  assert.strictEqual(r.counts.stoerungenOhneOrt, 1, `stoerungenOhneOrt: ${r.counts.stoerungenOhneOrt}`);

  // Baustelle vorhanden (von==bis -> Point).
  assert.strictEqual(r.baustellen.features.length, 1, `baustellen: ${r.baustellen.features.length}`);
  assert.strictEqual(r.baustellen.features[0]!.properties.kategorie, 'baustelle');
  assert.strictEqual(r.baustellen.features[0]!.geometry!.type, 'Point', 'von==bis -> Point');

  // Streckenruhe vorhanden.
  assert.strictEqual(r.streckenruhen.features.length, 1, `streckenruhen: ${r.streckenruhen.features.length}`);
  assert.strictEqual(r.streckenruhen.features[0]!.geometry!.type, 'Point', 'streckenruhe -> Point');

  // Sammelmeldungen-Liste enthaelt die Sammelmeldung (mit deduplizierten Verkehrsarten).
  assert.strictEqual(r.sammelmeldungen.length, 1, `sammelmeldungen: ${r.sammelmeldungen.length}`);
  assert.strictEqual(r.sammelmeldungen[0]!.key, 'BZI_28777');
  assert.deepStrictEqual(r.sammelmeldungen[0]!.verkehrsarten, ['SGV']);

  // counts konsistent.
  assert.deepStrictEqual(r.counts, {
    stoerungen: 2,
    stoerungenOhneOrt: 1,
    baustellen: 1,
    streckenruhen: 1,
    sammelmeldungen: 1,
  });
}

// --- stoerungenListe: verortete + nicht verortete Stoerungen ---
{
  const now = new Date(2026, 6, 6, 12, 0, 0); // Montag 12:00, aktiv
  const zeitraum = { beginn: '2026-07-01T00:00:00', ende: '2026-12-31T23:59:59' };
  const resolve: CoordResolver = (r) => (r === 'AA' ? [9.9, 48.4] : null);
  const roh: StreckenInfoRohdaten = {
    stoerungen: [
      { key: 'v', cause: 'Signalstoerung', subcause: 'x', text: 'verortet',
        zeitraum, betriebsstellen: [{ ril100: 'AA' }],
        wirkungenMitVerkehrsarten: [{ wirkung: 'Sperrung', verkehrsarten: ['FV', 'NV'] }] },
      { key: 'o', cause: 'Oberleitung', subcause: 'y', text: 'ohne Ort',
        zeitraum, gleisEinschraenkung: 'SCHWER' }, // keine Geo-Quelle -> nicht verortbar
    ],
    baustellen: [],
    streckenruhen: [],
    sammelmeldungen: [],
  };

  const r = baueGeoJson(roh, now, resolve);

  assert.strictEqual(r.stoerungen.features.length, 1, 'nur verortete in features');
  assert.strictEqual(r.stoerungenListe.length, 2, 'alle aktiven in stoerungenListe');
  const verortet = r.stoerungenListe.find((m) => m.key === 'v');
  const ohneOrt = r.stoerungenListe.find((m) => m.key === 'o');
  assert.ok(verortet && verortet.verortet === true, 'v ist verortet');
  assert.deepStrictEqual(verortet!.verkehrsarten.sort(), ['FV', 'NV'], 'verkehrsarten flach');
  assert.ok(ohneOrt && ohneOrt.verortet === false, 'o ist nicht verortet');
  assert.strictEqual(ohneOrt!.gleisEinschraenkung, 'SCHWER', 'gleisEinschraenkung uebernommen');
  assert.strictEqual(r.counts.stoerungenOhneOrt, 1, 'ohne-Ort-Zaehler unveraendert');
}

console.log('SELFTEST OK');

// --- 4) LIVE-Smoke (Netz + echte ISR-Daten): counts + error loggen ---
{
  try {
    // Echte Betriebsstellen laden, damit das RL100-Geocoding echt getestet wird.
    const data = new IsrData();
    const r = await new StreckenInfoService(data.stations).getData();
    console.log('LIVE counts:', JSON.stringify(r.counts));
    const verortet = r.counts.stoerungen;
    const gesamt = r.counts.stoerungen + r.counts.stoerungenOhneOrt;
    console.log(`LIVE Stoerungen verortet: ${verortet}/${gesamt}`);
    if (r.error != null) console.warn('LIVE WARNUNG error:', r.error);
    else console.log('LIVE error: null');
  } catch (e) {
    // getData() sollte nie werfen; falls doch, nur als Warnung ausgeben.
    console.warn('LIVE unerwartet geworfen:', e instanceof Error ? e.message : String(e));
  }
}

// --- LIVE-Smoke: force + onRefresh (nur Logging) ---
{
  const isr = new IsrData();
  let refreshed = 0;
  const svc = new StreckenInfoService(isr.stations, { onRefresh: () => { refreshed++; } });
  const erst = await svc.getData();             // 1. echter Scrape (Fehler stehen im error-Feld, kein throw)
  if (erst.error) {
    console.log('[live] uebersprungen (kein Netz):', erst.error);
  } else {
    await svc.getData();                         // Cache-Treffer -> refreshed unveraendert
    await svc.getData({ force: true });          // erzwungen -> refreshed++
    console.log(`[live] onRefresh-Aufrufe (erwartet 2): ${refreshed}`);
  }
}
