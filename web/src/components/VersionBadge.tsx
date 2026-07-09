'use client';

// Software-Version unten rechts (aus GET /api/version), dezent über der Attribution.
import { useEffect, useState } from 'react';
import { getVersion } from '@/lib/api';

export default function VersionBadge() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let aktiv = true;
    getVersion()
      .then((d) => { if (aktiv && d.version) setVersion(d.version); })
      .catch(() => { /* ohne Version einfach kein Badge */ });
    return () => { aktiv = false; };
  }, []);

  if (!version) return null;
  return <div className="version" title="Software-Version">{version}</div>;
}
