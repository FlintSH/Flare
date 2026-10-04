import { defineConfig } from '@playwright/test'

const base = process.env.DOCS_BASE || '/'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/releases.spec.mjs',
  fullyParallel: true,
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:4176${base}`,
    headless: true,
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'npx vite preview --outDir .vitepress/releases --host 127.0.0.1 --port 4176 --strictPort --base "$DOCS_BASE"',
    url: `http://127.0.0.1:4176${base}`,
    env: { DOCS_BASE: base },
    reuseExistingServer: !process.env.CI,
  },
})
