// Loest den realen Streckenverlauf zwischen zwei Betriebsstellen (RIL100) auf,
// damit Meldungen (Stoerungen/Baustellen) dem Gleis folgen statt der Luftlinie.
// Verantwortung: Verlaufs-Aufloesung (SRP). Haengt nur von Abstraktionen ab
// (Pathfinder, StationLookup) -> DIP, ohne Netz/Daten testbar.
import { haversine } from '../core/geo.js';
import type { Edge, Pathfinder, StationLookup, VerlaufLookup } from '../types.js';

// Umweg-Guard fuer die unbeschraenkte Suche: laeuft der kuerzeste Pfad um mehr
// als max(3 x Luftlinie, Luftlinie + 30 km) herum (Graph-Luecke), ist die
// Luftlinie die ehrlichere Darstellung als ein wilder Umweg.
const UMWEG_FAKTOR = 3;
const UMWEG_BONUS_KM = 30;

// Groessendeckel fuer den Memo-Cache: im Headless-Betrieb gibt es keinen
// Reload-Pfad, der ihn leert; realistisch sind wenige tausend Paare, der
// Deckel ist nur das Sicherheitsnetz gegen unbegrenztes Wachstum.
const CACHE_MAX = 5000;

/** Auf ~1 m runden (5 Nachkommastellen) – haelt den GeoJSON-Payload klein. */
function runde(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

// Vereinfachungs-Toleranz: Meldungs-Overlays (4-6 px breite Linien) brauchen
// keine Gleis-Praezision; 15 m sind auf allen Zoomstufen unsichtbar, druecken
// den /api/streckeninfo-Payload aber erheblich (wird alle 3 min gepollt).
const VEREINFACHUNG_M = 15;
const METER_JE_GRAD = 111_320;

/**
 * Douglas-Peucker auf einer [lon,lat]-Kette; Toleranz in Metern (equirektangular
 * genaehert, fuer Deutschland voellig ausreichend). Endpunkte bleiben erhalten.
 */
export function vereinfache(kette: [number, number][], toleranzM: number): [number, number][] {
  if (kette.length <= 2) return kette;
  const kx = METER_JE_GRAD * Math.cos((kette[0]![1] * Math.PI) / 180);
  const ky = METER_JE_GRAD;
  const behalten = new Array<boolean>(kette.length).fill(false);
  behalten[0] = behalten[kette.length - 1] = true;
  const stapel: [number, number][] = [[0, kette.length - 1]];
  while (stapel.length > 0) {
    const [a, b] = stapel.pop()!;
    const ax = kette[a]![0] * kx, ay = kette[a]![1] * ky;
    const bx = kette[b]![0] * kx, by = kette[b]![1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxDist = -1, maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = kette[i]![0] * kx - ax, py = kette[i]![1] * ky - ay;
      // Abstand Punkt->Segment (t auf [0,1] geklemmt; len2==0 -> Abstand zum Punkt a).
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx, ey = py - t * dy;
      const dist = Math.hypot(ex, ey);
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxIdx >= 0 && maxDist > toleranzM) {
      behalten[maxIdx] = true;
      stapel.push([a, maxIdx], [maxIdx, b]);
    }
  }
  return kette.filter((_, i) => behalten[i]);
}

export class VerlaufResolver {
  /** Memo je Betriebsstellen-Paar+Strecken; symmetrisch (B,A) = reverse von (A,B). */
  private cache = new Map<string, [number, number][] | null>();

  constructor(private pathfinder: Pathfinder, private stations: StationLookup) {}

  /** Nach einem Daten-Reload aufrufen: Graph/Geometrien koennten sich geaendert haben. */
  leereCache(): void {
    this.cache.clear();
  }

  /** Signatur von VerlaufLookup (types.ts); als Methode fuer DI bequem bindbar. */
  resolve: VerlaufLookup = (vonRil100, bisRil100, streckennummern) => {
    const von = this.stel(vonRil100);
    const bis = this.stel(bisRil100);
    if (von == null || bis == null || von === bis) return null;

    const strecken = [...new Set(streckennummern ?? [])].sort((a, b) => a - b);
    const vorwaerts = von <= bis;
    const key = `${Math.min(von, bis)}|${Math.max(von, bis)}|${strecken.join(',')}`;
    let kette = this.cache.get(key);
    if (kette === undefined) {
      kette = this.berechne(vorwaerts ? von : bis, vorwaerts ? bis : von, strecken);
      if (this.cache.size >= CACHE_MAX) this.cache.clear();
      this.cache.set(key, kette);
    }
    if (kette === null) return null;
    return vorwaerts ? kette : [...kette].reverse();
  };

  /**
   * RIL100 zu stel. Bahnhofsteil-Codes (Leerzeichen-Suffix, z. B. "TU  P" fuer
   * einen Bft von Ulm Hbf) fehlen in der ISR-Stationsliste; sie fallen auf die
   * Basis-Betriebsstelle ("TU") zurueck – leicht versetzter Endpunkt, aber
   * realer Verlauf statt Luftlinie.
   */
  private stel(ril100: string): number | null {
    const code = ril100.trim();
    const direkt = this.stations.resolveStel(code);
    if (direkt != null) return direkt;
    const basis = code.split(/\s+/)[0];
    return basis && basis !== code ? this.stations.resolveStel(basis) : null;
  }

  /**
   * Suchreihenfolge: a) auf die gemeldeten Streckennummern beschraenkt (folgt der
   * tatsaechlich betroffenen Linie, expandiert nur deren Knoten); b) unbeschraenkt
   * wie die Routenfindung, aber mit Umweg-Guard; c) null (-> Luftlinien-Fallback).
   */
  private berechne(start: number, ziel: number, strecken: number[]): [number, number][] | null {
    if (strecken.length > 0) {
      const set = new Set(strecken);
      const pfad = this.pathfinder.dijkstra(start, ziel, 'short',
        (e) => e.strecke != null && set.has(e.strecke));
      const kette = pfad ? VerlaufResolver.kette(pfad.edges) : [];
      if (kette.length >= 2) return vereinfache(kette, VEREINFACHUNG_M);
    }

    const pfad = this.pathfinder.dijkstra(start, ziel, 'short');
    if (!pfad) return null;
    const kette = VerlaufResolver.kette(pfad.edges);
    if (kette.length < 2) return null;
    const distKm = pfad.edges.reduce((s, e) => s + e.distKm, 0);
    const [aLon, aLat] = kette[0]!;
    const [bLon, bLat] = kette[kette.length - 1]!;
    const luftKm = haversine([aLat, aLon], [bLat, bLon]);
    if (distKm > Math.max(luftKm * UMWEG_FAKTOR, luftKm + UMWEG_BONUS_KM)) return null;
    return vereinfache(kette, VEREINFACHUNG_M);
  }

  /** Kanten-Geometrien ([lat,lon]) zu einer [lon,lat]-Kette verbinden (Stoesse dedupliziert). */
  private static kette(edges: Edge[]): [number, number][] {
    const out: [number, number][] = [];
    for (const e of edges) {
      for (const [lat, lon] of e.coords) {
        const p: [number, number] = [runde(lon), runde(lat)];
        const last = out[out.length - 1];
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        out.push(p);
      }
    }
    return out;
  }
}
