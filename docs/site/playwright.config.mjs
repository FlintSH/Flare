import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/releases.spec.mjs',
  fullyParallel: true,
  // One worker per core on a CI runner, which runs nothing else. Two keeps a
  // shared development machine responsive.
  workers: process.env.CI ? '100%' : 2,
  use: {
    baseURL: `http://127.0.0.1:4175${process.env.DOCS_BASE || '/'}`,
    headless: true,
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4175',
    port: 4175,
    reuseExistingServer: false,
  },
})
