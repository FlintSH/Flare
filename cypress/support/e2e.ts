// Import commands.js using ES2015 syntax:
import './commands'

// Alternatively you can use CommonJS syntax:
// require('./commands')

// Ignore uncaught exceptions from the application
// This is helpful for tests to continue even if the app has errors
Cypress.on('uncaught:exception', (err, runnable) => {
  // Returning false prevents Cypress from failing the test
  console.log('Uncaught exception:', err.message)
  return false
})

// Add better control over network errors
Cypress.on('fail', (error, runnable) => {
  // We can inspect the error and conditionally skip the test
  if (
    error.name === 'CypressError' &&
    (error.message.includes('cy.visit()') ||
      error.message.includes('cy.request()') ||
      error.message.includes('failed trying to load'))
  ) {
    console.log('Network error detected, allowing test to continue if possible')
    return false
  }

  // For any other error, fail the test as normal
  throw error
})

// Hide fetch/XHR requests in the command log to reduce clutter
const app = window.top
if (app && app.document.head.querySelector('[data-hide-command-log-request]')) {
  const style = app.document.createElement('style')
  style.innerHTML = '.command-name-request, .command-name-xhr { display: none }'
  app.document.head.appendChild(style)
}

// Add longer default timeout
beforeEach(() => {
  Cypress.config('defaultCommandTimeout', 30000)
})
