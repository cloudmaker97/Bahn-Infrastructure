'use client';

// Software version at the bottom right (from GET /api/version), subtly above the attribution.
import { useEffect, useState } from 'react';
import { getVersion } from '@/lib/api';

export default function VersionBadge() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let active = true;
    getVersion()
      .then((d) => { if (active && d.version) setVersion(d.version); })
      .catch(() => { /* no version -> simply no badge */ });
    return () => { active = false; };
  }, []);

  if (!version) return null;
  return <div className="version" title="Software-Version">{version}</div>;
}
