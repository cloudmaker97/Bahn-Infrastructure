// Indexiert Streckenabschnitte nach Streckennummer. Verantwortung: Abschnitts-Repository (SRP).
// Implementiert AbschnittLookup (fuer die TUI-Detailansicht einer Strecke).
import { parseGermanNumber } from '../core/geo.js';
import type { JsonStore } from './json-store.js';
import type { AbschnittProps, AbschnittLookup } from '../types.js';

export class AbschnittRepository implements AbschnittLookup {
  private byNr = new Map<number, AbschnittProps[]>();

  constructor(rawStore: JsonStore) {
    const rows = rawStore.read<AbschnittProps[]>('streckenabschnitte_meta.json') ?? [];
    for (const r of rows) {
      const nr = r.ISR_STRE_NR;
      if (nr == null) continue;
      let list = this.byNr.get(nr);
      if (!list) { list = []; this.byNr.set(nr, list); }
      list.push(r);
    }
    // je Strecke nach Anfangs-Kilometer sortieren
    for (const list of this.byNr.values()) {
      list.sort((a, b) => parseGermanNumber(a.ISR_KM_VON_I) - parseGermanNumber(b.ISR_KM_VON_I));
    }
  }

  byStrecke(streckenNr: number): AbschnittProps[] {
    return this.byNr.get(streckenNr) ?? [];
  }
}
