// Next-Konfiguration für das ISR-Web-Frontend.
// Prod: statischer Export nach web/out (der Node-Server liefert die Artefakte aus,
// gleiche Origin -> kein Proxy nötig). Dev: kein Export, damit die rewrites greifen
// (`output: 'export'` würde rewrites deaktivieren – daher die Fallunterscheidung;
// `next build` setzt NODE_ENV=production, `next dev` setzt development).
import { fileURLToPath } from 'node:url';

const istProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: istProd ? 'export' : undefined,

  // Workspace-Wurzel = Repo-Wurzel (wegen der Importe aus ../src/shared); sonst
  // rät Next anhand von Lockfiles und kann daneben liegen.
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),

  // Erlaubt Importe außerhalb von web/ – die gemeinsame reine Logik liegt in
  // ../src/shared (eine Quelle für Server und Web, via tsconfig-Alias @shared/*).
  experimental: { externalDir: true },

  webpack: (config) => {
    // Die Module unter ../src/shared importieren untereinander mit ".js"-Endung
    // (Node-ESM-Konvention des Backends). extensionAlias lässt Webpack dafür
    // auch die .ts-Quelle auflösen.
    config.resolve.extensionAlias = { '.js': ['.js', '.ts'] };
    return config;
  },

  // Nur im Dev wirksam (der statische Export ignoriert rewrites): /api/* und /data/*
  // werden auf den Node-Server durchgereicht (Ziel via API_PROXY, Standard Port 8000).
  ...(istProd
    ? {}
    : {
        async rewrites() {
          const ziel = process.env.API_PROXY || 'http://localhost:8000';
          return [
            { source: '/api/:path*', destination: `${ziel}/api/:path*` },
            { source: '/data/:path*', destination: `${ziel}/data/:path*` },
          ];
        },
      }),
};

export default nextConfig;
