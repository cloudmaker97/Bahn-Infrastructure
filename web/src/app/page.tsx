'use client';

// Entry page: loads the map application without SSR – MapLibre needs `window`,
// hence the dynamic import with ssr:false (only allowed in client components).
import dynamic from 'next/dynamic';

const MapApp = dynamic(() => import('@/components/MapApp'), { ssr: false });

export default function Page() {
  return <MapApp />;
}
