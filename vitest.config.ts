import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'coverage'],
    pool: 'forks',
  },
})
