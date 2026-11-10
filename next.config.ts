import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: process.env.METICULOUS_BUILD === 'true',
  reactCompiler: true,
  serverExternalPackages: [
    'tesseract.js',
    '@alwaysmeticulous/backend-recorder-launcher',
  ],
  // Uploads and in-progress upload data live here at runtime. Keep them out
  // of route traces, so builds don't copy them into .next/standalone.
  outputFileTracingExcludes: {
    '/*': ['./uploads/**/*', './tmp/**/*'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Pages opened from other sites, or that open them, get no window
          // reference to each other. Flare's own links already use noopener.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // The service worker answers local addresses for pages anywhere in
        // the application (docs/e2ee-spec.md, section 12.2). A worker script
        // may control only paths under its own unless this header names a
        // wider scope. A proxy that serves /_next/static itself must send
        // it too. The policy lets the worker fetch from this origin only
        // and run no other script.
        source: '/_next/static/service-worker/:path*',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; connect-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: '/auth/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/api/auth/email/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default nextConfig
