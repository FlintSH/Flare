import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: process.env.METICULOUS_BUILD === 'true',
  experimental: {
    reactCompiler: true,
  },
  serverExternalPackages: [
    'tesseract.js',
    '@alwaysmeticulous/backend-recorder-launcher',
  ],
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
