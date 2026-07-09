'use client';

// Streckensuche: Nummern-Eingabe + Zoom-Button (Enter löst ebenfalls aus).
// Die eigentliche Suche (Highlight + fitBounds) übernimmt der StreckenLayer;
// die Status-Meldung setzt der Aufrufer über die Strecken-Statuszeile.
import { useState } from 'react';

interface SearchFormProps {
  onSearch: (nr: string) => void;
}

export default function SearchForm({ onSearch }: SearchFormProps) {
  const [nr, setNr] = useState('');
  const suchen = (): void => {
    const s = nr.trim();
    if (s) onSearch(s);
  };
  return (
    <>
      <label htmlFor="search">Streckennummer suchen</label>
      <div className="row">
        <input
          id="search"
          type="text"
          inputMode="numeric"
          placeholder="z. B. 1011"
          value={nr}
          onChange={(e) => setNr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') suchen(); }}
        />
        <button type="button" className="btn btn-primary" style={{ flex: '0 0 64px' }} onClick={suchen}>
          Zoom
        </button>
      </div>
    </>
  );
}
