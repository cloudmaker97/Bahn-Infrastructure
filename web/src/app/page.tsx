'use client';

// Einstiegsseite: lädt die Kartenanwendung ohne SSR – MapLibre braucht `window`,
// daher dynamic import mit ssr:false (nur in Client-Komponenten erlaubt).
import dynamic from 'next/dynamic';

const MapApp = dynamic(() => import('@/components/MapApp'), { ssr: false });

export default function Page() {
  return <MapApp />;
}
