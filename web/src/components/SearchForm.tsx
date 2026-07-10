'use client';

// Line search: number input + zoom button (Enter triggers too).
// The actual search (highlight + fitBounds) is done by the RailNetworkLayer;
// the caller sets the status message via the rail-network status line.
import { useState } from 'react';

interface SearchFormProps {
  onSearch: (nr: string) => void;
}

export default function SearchForm({ onSearch }: SearchFormProps) {
  const [nr, setNr] = useState('');
  const search = (): void => {
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
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
        />
        <button type="button" className="btn btn-primary" style={{ flex: '0 0 64px' }} onClick={search}>
          Zoom
        </button>
      </div>
    </>
  );
}
