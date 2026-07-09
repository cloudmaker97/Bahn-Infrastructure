// Reine Geo-/Parsing-Hilfsfunktionen (zustandslos, keine Klasse noetig).
import type { LatLng } from '../types.js';

/** Parst eine Zahl mit deutschem Dezimalkomma. */
export function parseGermanNumber(v: unknown): number {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(',', '.'));
}

/** Haversine-Distanz in km zwischen zwei [lat,lon]-Punkten. */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const la1 = a[0] * toRad, la2 = b[0] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Gesamtlaenge eines Polylinienzugs ([lat,lon]) in km. */
export function polylineLengthKm(coords: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversine(coords[i - 1]!, coords[i]!);
  return km;
}

// Zwei Stuetzpunkte gelten als identisch (Stoss zweier Teilstuecke), wenn sie
// naeher als das liegen – dann wird der doppelte Punkt am Stoss entfernt. 1 m ist
// weit unter dem realen Stuetzpunkt-Abstand (~200 m), verschmilzt also nichts Echtes.
const STOSS_KM = 0.001;

// Zwei Teilstuecke gelten als parallele Doppelgeometrie, wenn BEIDE Endpunkte
// (in irgendeiner Orientierung) naeher als das beieinanderliegen. 60 m fangen den
// Gleisabstand paralleler Richtungs-/Gegengleise ein, liegen aber weit unter der
// Laenge eigenstaendiger Fragmente (hunderte Meter+), verschmelzen also nichts Echtes.
const DUPLIKAT_KM = 0.06;

/** Liegen zwei Punkte naeher als `km` km beieinander? */
function nahbei(a: LatLng, b: LatLng, km: number): boolean {
  return haversine(a, b) < km;
}

/**
 * Verkettet die Teilstuecke einer MultiLineString-Geometrie zu EINER moeglichst
 * lueckenlosen [lat,lon]-Kette. Die ISR-Abschnittsgeometrien sind doppelt fies:
 *  1. Ihre Fragmente liegen in BELIEBIGER Reihenfolge UND Orientierung vor –
 *     blindes Aneinanderhaengen in Datei-reihenfolge erzeugt grosse Sprunge.
 *  2. Ein Abschnitt enthaelt oft BEIDE parallelen Gleise (Richtungs-/Gegengleis)
 *     als eigene, den gleichen Von->Bis-Weg abdeckende Teilstuecke. Wuerde man sie
 *     mitverketten, liefe die Kante aus und wieder zurueck (Schleife).
 *
 * Daher: erst parallele Duplikat-Teilstuecke verwerfen (gleiches Endpunkt-Paar),
 * dann den Rest greedy verketten – stets das Teilstueck anbauen, dessen naechstes
 * Ende dem Ketten-Kopf ODER -Ende am naechsten liegt (bei Bedarf umgedreht). Echte
 * Datenluecken (weit entfernte Fragmente) bleiben ein Sprung; das ist ehrlicher
 * als ein kuenstlicher Zickzack.
 */
export function verketteTeilstuecke(teile: LatLng[][]): LatLng[] {
  const roh = teile.filter((t) => t.length > 0).map((t) => t.slice());
  if (roh.length === 0) return [];
  // Parallele Doppelgeometrie entfernen (nur das erste Teilstueck je Endpunkt-Paar).
  const rest: LatLng[][] = [];
  for (const t of roh) {
    const a = t[0]!, b = t[t.length - 1]!;
    const doppelt = rest.some((u) => {
      const ua = u[0]!, ub = u[u.length - 1]!;
      return (nahbei(a, ua, DUPLIKAT_KM) && nahbei(b, ub, DUPLIKAT_KM))
        || (nahbei(a, ub, DUPLIKAT_KM) && nahbei(b, ua, DUPLIKAT_KM));
    });
    if (!doppelt) rest.push(t);
  }
  const kette: LatLng[] = rest.shift()!;
  while (rest.length > 0) {
    const kopf = kette[0]!;
    const ende = kette[kette.length - 1]!;
    let idx = -1, minDist = Infinity, anEnde = true, umdrehen = false;
    for (let i = 0; i < rest.length; i++) {
      const s = rest[i]![0]!;
      const e = rest[i]![rest[i]!.length - 1]!;
      // An das Ketten-Ende anhaengen (Anschlusspunkt soll part[0] werden).
      if (haversine(ende, s) < minDist) { minDist = haversine(ende, s); idx = i; anEnde = true; umdrehen = false; }
      if (haversine(ende, e) < minDist) { minDist = haversine(ende, e); idx = i; anEnde = true; umdrehen = true; }
      // Vor den Ketten-Kopf setzen (Anschlusspunkt soll part[last] werden).
      if (haversine(kopf, e) < minDist) { minDist = haversine(kopf, e); idx = i; anEnde = false; umdrehen = false; }
      if (haversine(kopf, s) < minDist) { minDist = haversine(kopf, s); idx = i; anEnde = false; umdrehen = true; }
    }
    let teil = rest.splice(idx, 1)[0]!;
    if (umdrehen) teil.reverse();
    if (anEnde) {
      if (haversine(kette[kette.length - 1]!, teil[0]!) < STOSS_KM) teil = teil.slice(1);
      kette.push(...teil);
    } else {
      if (haversine(kette[0]!, teil[teil.length - 1]!) < STOSS_KM) teil = teil.slice(0, -1);
      kette.unshift(...teil);
    }
  }
  return kette;
}

/** Parst 'ALG_GEO_LAGE' ('+9.13, 49.95') zu [lat, lon] oder null. */
export function parseLage(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.replace(/\+/g, '').split(',').map((x) => parseFloat(x));
  if (parts.length === 2 && isFinite(parts[0]!) && isFinite(parts[1]!)) {
    return { lon: parts[0]!, lat: parts[1]! };
  }
  return null;
}
