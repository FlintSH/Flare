import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
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
    reuseExistingServer: !process.env.CI,
  },
})
