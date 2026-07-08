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

/** Parst 'ALG_GEO_LAGE' ('+9.13, 49.95') zu [lat, lon] oder null. */
export function parseLage(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.replace(/\+/g, '').split(',').map((x) => parseFloat(x));
  if (parts.length === 2 && isFinite(parts[0]!) && isFinite(parts[1]!)) {
    return { lon: parts[0]!, lat: parts[1]! };
  }
  return null;
}
