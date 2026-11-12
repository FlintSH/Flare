import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  serverExternalPackages: ['tesseract.js'],
  // Put every page's metadata in its <head>, whoever asks. By default only
  // fetchers Next.js knows by name get that, and the rest find a share
  // page's preview tags streamed into the body, where many never look.
  htmlLimitedBots: /.*/,
  // Uploads and in-progress upload data live here at runtime. Keep them out
  // of route traces, so builds don't copy them into .next/standalone.
  outputFileTracingExcludes: {
    '/*': ['./uploads/**/*', './tmp/**/*'],
  },
  // Browsers ask for /favicon.ico on pages that link no icon, such as an
  // image or PDF opened on its own, so answer it with the custom favicon.
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/api/favicon' }]
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
