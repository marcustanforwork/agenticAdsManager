// The dashboard (M10a): Next.js on Vercel Pro behind Cloudflare Access (D-054). It imports only @ads/contracts and
// @ads/db (BLUEPRINT §2), through their built `dist/` (turbo builds them first).
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Loaded by Node at run time, not bundled: @ads/db locates its migrations through `import.meta.url` (which the
  // bundler would try to resolve as an asset), and pg loads optional native bindings.
  serverExternalPackages: ['@ads/db', 'drizzle-orm', 'pg'],
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ]);
  },
};

export default config;
