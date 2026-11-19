import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// full-test 15/11 PUBLIC-04: in the browser bundles, the catalogue module of `@djaber/shared` (CommonJS barrel, not
// tree-shaken: all three languages, ≈ 2.3 MB) is replaced by an empty stand-in. Client components get their texts from the
// layouts (lib/server-messages.tsx); a screen that needs the whole catalogue imports `@djaber/shared/messages` (kept).
const CLIENT_CATALOGUE_STUB = resolve(__dirname, 'src/i18n/client-catalogue-stub.ts');
const SHARED_DIST = /[\\/](?:packages[\\/]shared|@djaber[\\/]shared)[\\/]dist(?:[\\/]i18n)?$/;

// `NEXT_DIST_DIR=.next-dev` lets a development server run next to the production build served to the team (`.next`)
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@djaber/ui'],
  poweredByHeader: false,
  webpack(cfg, { isServer, webpack }) {
    if (!isServer)
      cfg.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^\.\/(?:i18n\/)?messages$/, (r: { context?: string; request: string }) => {
          if (r.context && SHARED_DIST.test(r.context)) r.request = CLIENT_CATALOGUE_STUB;
        }),
      );
    return cfg;
  },
  eslint: { ignoreDuringBuilds: true }, // lint runs as its own CI step
  // full-test 15/11 PUBLIC-03 (07-non-functional §security): no other site may frame the app (clickjacking on login /
  // sign-up / account deletion); the app's own print frames (labels) stay allowed (same origin)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
