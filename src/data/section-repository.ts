// Indexes line sections by line number and by operating point. Responsibility:
// section repository (SRP). Implements SectionLookup (for the TUI detail views).
import { parseGermanNumber } from '../core/geometry.js';
import type { JsonStore } from './json-store.js';
import type { SectionProps, SectionLookup } from '../types.js';

export class SectionRepository implements SectionLookup {
  private sectionsByLine = new Map<number, SectionProps[]>();
  private sectionsByStation = new Map<number, SectionProps[]>(); // STEL_ID (start OR end) -> sections

  constructor(rawStore: JsonStore) {
    const rows = rawStore.read<SectionProps[]>('streckenabschnitte_meta.json') ?? [];
    for (const r of rows) {
      const nr = r.ISR_STRE_NR;
      if (nr != null) {
        let list = this.sectionsByLine.get(nr);
        if (!list) { list = []; this.sectionsByLine.set(nr, list); }
        list.push(r);
      }
      // Index by both endpoints; a section may appear once per end.
      for (const stel of [r.ISR_STEL_ID_VON, r.ISR_STEL_ID_BIS]) {
        if (stel == null) continue;
        let list = this.sectionsByStation.get(stel);
        if (!list) { list = []; this.sectionsByStation.set(stel, list); }
        list.push(r);
      }
    }
    // Sort per line by starting kilometer.
    for (const list of this.sectionsByLine.values()) {
      list.sort((a, b) => parseGermanNumber(a.ISR_KM_VON_I) - parseGermanNumber(b.ISR_KM_VON_I));
    }
    // Sort per operating point by line number, then starting kilometer.
    for (const list of this.sectionsByStation.values()) {
      list.sort((a, b) =>
        (a.ISR_STRE_NR ?? 0) - (b.ISR_STRE_NR ?? 0) ||
        parseGermanNumber(a.ISR_KM_VON_I) - parseGermanNumber(b.ISR_KM_VON_I));
    }
  }

  byLineNumber(lineNumber: number): SectionProps[] {
    return this.sectionsByLine.get(lineNumber) ?? [];
  }

  byStation(stel: number): SectionProps[] {
    return this.sectionsByStation.get(stel) ?? [];
  }
}
