'use client';

// Map search: text input + zoom button (Enter triggers too). Accepts a line
// number, an RL100 code, or a live-train name/number; the actual resolution
// (highlight/flyTo/fitBounds) is done by MapSearch – the caller sets the
// status message via the rail-network status line.
import { useState } from 'react';

interface SearchFormProps {
  onSearch: (query: string) => void;
}

export default function SearchForm({ onSearch }: SearchFormProps) {
  const [query, setQuery] = useState('');
  const search = (): void => {
    const s = query.trim();
    if (s) onSearch(s);
  };
  return (
    <>
      <label htmlFor="search">Strecke, RL100 oder Zug suchen</label>
      <div className="row">
        <input
          id="search"
          type="text"
          placeholder="z. B. 1011, FF, ICE 577"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
        />
        <button type="button" className="btn btn-primary" style={{ flex: '0 0 64px' }} onClick={search}>
          Zoom
        </button>
      </div>
    </>
  );
}
