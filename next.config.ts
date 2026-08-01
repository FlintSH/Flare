import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    reactCompiler: true,
  },
  serverExternalPackages: ['tesseract.js'],
  // Scoped to the OCR core package on purpose: a bare `node_modules/**` glob
  // walks pnpm's symlinked store and exhausts the heap while collecting build
  // traces. tesseract.js-core is a direct dependency so this path is stable.
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/tesseract.js-core/**/*.wasm'],
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
        ],
      },
    ]
  },
}

export default nextConfig
