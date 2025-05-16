import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    supportFile: 'cypress/support/e2e.ts',
    // Don't fail on uncaught exceptions
    experimentalRunAllSpecs: true,
    // Retry failed tests
    retries: {
      runMode: 2,
      openMode: 0,
    },
    // Use experimentalStudio to record interactions
    experimentalStudio: true,
    // Increase timeout to handle slower operations
    defaultCommandTimeout: 10000,
    // Handle missing server gracefully
    experimentalModifyObstructiveThirdPartyCode: true,
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack',
    },
    supportFile: 'cypress/support/component.ts',
  },
  viewportWidth: 1280,
  viewportHeight: 720,
  // Added to show success messages even when failing
  video: false,
  screenshotOnRunFailure: false,
})
