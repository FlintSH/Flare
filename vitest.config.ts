import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The App Router's `next/dynamic`, which the build substitutes for
      // files under app/. Node alone resolves the Pages Router's, which
      // renders nothing on the server until its modules are preloaded.
      'next/dynamic': 'next/dist/shared/lib/app-dynamic',
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'coverage'],
    pool: 'forks',
  },
})
