// Indexiert Streckenabschnitte nach Streckennummer. Verantwortung: Abschnitts-Repository (SRP).
// Implementiert AbschnittLookup (fuer die TUI-Detailansicht einer Strecke).
import { parseGermanNumber } from '../core/geo.js';
import type { JsonStore } from './json-store.js';
import type { AbschnittProps, AbschnittLookup } from '../types.js';

export class AbschnittRepository implements AbschnittLookup {
  private byNr = new Map<number, AbschnittProps[]>();
  private byStel = new Map<number, AbschnittProps[]>(); // STEL_ID (von ODER bis) -> Abschnitte

  constructor(rawStore: JsonStore) {
    const rows = rawStore.read<AbschnittProps[]>('streckenabschnitte_meta.json') ?? [];
    for (const r of rows) {
      const nr = r.ISR_STRE_NR;
      if (nr != null) {
        let list = this.byNr.get(nr);
        if (!list) { list = []; this.byNr.set(nr, list); }
        list.push(r);
      }
      // Nach beiden Endpunkten indexieren; ein Abschnitt kann je Ende einmal auftauchen.
      for (const stel of [r.ISR_STEL_ID_VON, r.ISR_STEL_ID_BIS]) {
        if (stel == null) continue;
        let list = this.byStel.get(stel);
        if (!list) { list = []; this.byStel.set(stel, list); }
        list.push(r);
      }
    }
    // je Strecke nach Anfangs-Kilometer sortieren
    for (const list of this.byNr.values()) {
      list.sort((a, b) => parseGermanNumber(a.ISR_KM_VON_I) - parseGermanNumber(b.ISR_KM_VON_I));
    }
    // je Betriebsstelle nach Streckennummer, dann Anfangs-Kilometer sortieren
    for (const list of this.byStel.values()) {
      list.sort((a, b) =>
        (a.ISR_STRE_NR ?? 0) - (b.ISR_STRE_NR ?? 0) ||
        parseGermanNumber(a.ISR_KM_VON_I) - parseGermanNumber(b.ISR_KM_VON_I));
    }
  }

  byStrecke(streckenNr: number): AbschnittProps[] {
    return this.byNr.get(streckenNr) ?? [];
  }

  byStation(stel: number): AbschnittProps[] {
    return this.byStel.get(stel) ?? [];
  }
}
