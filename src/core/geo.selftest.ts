// Selbsttest fuer die reinen Geo-Helfer (Fokus: verketteTeilstuecke).
// Laufbar mit: npx tsx src/core/geo.selftest.ts
import assert from 'node:assert';
import { verketteTeilstuecke, polylineLengthKm } from './geo.js';
import type { LatLng } from '../types.js';

/** Groesster Sprung zwischen zwei aufeinanderfolgenden Stuetzpunkten (km). */
function maxSegKm(kette: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < kette.length; i++) {
    const d = polylineLengthKm([kette[i - 1]!, kette[i]!]);
    if (d > m) m = d;
  }
  return m;
}

// Eine glatte Referenzkette (Stuetzpunkte ~200 m Abstand entlang eines Meridians).
const N = 12;
const REF: LatLng[] = Array.from({ length: N }, (_, i) => [49.5 + i * 0.002, 11.4] as LatLng);

// --- 1) Bereits verkettete Eingabe bleibt unveraendert (bis auf Stoss-Dedup) ---
{
  const teile = [REF.slice(0, 5), REF.slice(4, 9), REF.slice(8)]; // schon in Ordnung, Stoesse ueberlappen
  const kette = verketteTeilstuecke(teile);
  assert.ok(maxSegKm(kette) < 0.3, `intakte Kette: maxSeg ${maxSegKm(kette)} km`);
  // Endpunkte bleiben die der Gesamtstrecke.
  assert.deepStrictEqual(kette[0], REF[0]);
  assert.deepStrictEqual(kette[kette.length - 1], REF[N - 1]);
}

// --- 2) Vertauschte UND umgedrehte Teilstuecke -> glatte Kette (Kern des Fixes) ---
{
  // Reihenfolge durcheinander und einzelne Fragmente umgedreht, wie in den ISR-Daten.
  const a = REF.slice(0, 4);
  const b = REF.slice(3, 7).reverse();   // umgedreht
  const c = REF.slice(6, 10);
  const d = REF.slice(9).reverse();      // umgedreht
  const durcheinander = [c, a, d, b];    // Datei-Reihenfolge beliebig

  const naiv: LatLng[] = [];
  for (const t of durcheinander) naiv.push(...t);
  assert.ok(maxSegKm(naiv) > 0.5, `naive Verkettung springt: maxSeg ${maxSegKm(naiv)} km`);

  const kette = verketteTeilstuecke(durcheinander);
  assert.ok(maxSegKm(kette) < 0.3, `verkettet glatt: maxSeg ${maxSegKm(kette)} km`);
  // Die Kette deckt alle Punkte ab und laeuft monoton (Gesamtlaenge ~ Referenz).
  const refLen = polylineLengthKm(REF);
  assert.ok(Math.abs(polylineLengthKm(kette) - refLen) < 0.05,
    `Laenge ~ Referenz: ${polylineLengthKm(kette)} vs ${refLen}`);
}

// --- 3) Parallele Doppelgeometrie (Richtungs-/Gegengleis) -> KEINE Schleife ---
{
  // Zwei nahezu deckungsgleiche Teilstuecke (~10 m versetzt), beide Von->Bis.
  // Ohne Dedup wuerde das zweite rueckwaerts angehaengt -> Kette laeuft aus und
  // zurueck (Ende ~ Anfang). Mit Dedup bleibt eine saubere Von->Bis-Linie.
  const gleisA = REF.map(([la, lo]) => [la, lo] as LatLng);
  const gleisB = REF.map(([la, lo]) => [la, lo + 0.0001] as LatLng); // ~7 m parallel versetzt
  const kette = verketteTeilstuecke([gleisA, gleisB]);
  const zurueck = polylineLengthKm([kette[0]!, kette[kette.length - 1]!]);
  const refLen = polylineLengthKm(REF);
  assert.ok(zurueck > refLen * 0.9,
    `keine Schleife: Endpunkt-Abstand ${zurueck.toFixed(2)} ~ Streckenlaenge ${refLen.toFixed(2)}`);
  assert.ok(polylineLengthKm(kette) < refLen * 1.2,
    `Laenge nicht verdoppelt: ${polylineLengthKm(kette).toFixed(2)} km`);
}

// --- 4) Randfaelle ---
{
  assert.deepStrictEqual(verketteTeilstuecke([]), []);
  assert.deepStrictEqual(verketteTeilstuecke([[]]), []);
  const eins = REF.slice(0, 3);
  assert.deepStrictEqual(verketteTeilstuecke([eins]), eins, 'einzelnes Teilstueck unveraendert');
}

console.log('SELFTEST OK');
