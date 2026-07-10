// Next configuration for the ISR web frontend.
// Prod: static export to web/out (the Node server serves the artifacts, same
// origin -> no proxy needed). Dev: no export so the rewrites apply
// (`output: 'export'` would disable rewrites – hence the case distinction;
// `next build` sets NODE_ENV=production, `next dev` sets development).
import { fileURLToPath } from 'node:url';

const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isProd ? 'export' : undefined,

  // Workspace root = repo root (because of the imports from ../src/shared);
  // otherwise Next guesses from lockfiles and can get it wrong.
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),

  // Allows imports outside web/ – the shared pure logic lives in ../src/shared
  // (one source for server and web, via the tsconfig alias @shared/*).
  experimental: { externalDir: true },

  webpack: (config) => {
    // The modules under ../src/shared import each other with a ".js" extension
    // (Node ESM convention of the backend). extensionAlias lets webpack resolve
    // the .ts source for those too.
    config.resolve.extensionAlias = { '.js': ['.js', '.ts'] };
    return config;
  },

  // Effective in dev only (the static export ignores rewrites): /api/* and /data/*
  // are passed through to the Node server (target via API_PROXY, default port 8000).
  ...(isProd
    ? {}
    : {
        async rewrites() {
          const target = process.env.API_PROXY || 'http://localhost:8000';
          return [
            { source: '/api/:path*', destination: `${target}/api/:path*` },
            { source: '/data/:path*', destination: `${target}/data/:path*` },
          ];
        },
      }),
};

export default nextConfig;
