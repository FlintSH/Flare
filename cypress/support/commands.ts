// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
import '@testing-library/cypress/add-commands'

// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
//

/**
 * Login via the UI by visiting the login page and submitting the form
 */
Cypress.Commands.add('loginViaUI', (email: string, password: string) => {
  cy.visit('/auth/login')
  cy.get('input[name="email"], input[type="email"]').first().type(email)
  cy.get('input[name="password"], input[type="password"]')
    .first()
    .type(password)
  cy.get('button[type="submit"]').click()
  // Wait for redirection or success indicator
  cy.url().should('not.include', '/auth/login')
})

/**
 * Mock the authentication by setting a test session in localStorage
 * This is a more resilient approach than directly visiting routes that require auth
 */
Cypress.Commands.add(
  'loginBySession',
  (user = { email: 'test@example.com', name: 'Test User' }) => {
    cy.log('Attempting to set mock session for authentication bypass')

    // Visit the home page first to ensure domain cookies can be set
    cy.visit('/', {
      // Don't fail the test if the page doesn't load
      failOnStatusCode: false,
      // Increase timeout
      timeout: 10000,
      // Don't wait for page load event
      retryOnNetworkFailure: true,
    }).then(() => {
      // Try to set a mock session in localStorage
      cy.window().then((win) => {
        try {
          // Set a mock session - structure depends on auth implementation
          // This is a common Next-Auth pattern but might need adjustment
          const mockSession = {
            user,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }

          // Store in localStorage - adjust key based on actual implementation
          win.localStorage.setItem(
            'next-auth.session-token',
            JSON.stringify(mockSession)
          )
          win.localStorage.setItem('userSession', JSON.stringify(mockSession))

          // Also try to set a cookie (for implementations that use cookies)
          win.document.cookie = `next-auth.session-token=${JSON.stringify(mockSession)}; path=/; max-age=86400`
          win.document.cookie = `__Secure-next-auth.session-token=${JSON.stringify(mockSession)}; path=/; max-age=86400`

          cy.log('Mock session set successfully')
        } catch (error) {
          cy.log(`Error setting mock session: ${error}`)
        }
      })
    })
  }
)

// Declare the Cypress namespace to add the custom commands
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Login through the UI by submitting the login form
       * @example cy.loginViaUI('user@example.com', 'password')
       */
      loginViaUI(email: string, password: string): Chainable<void>

      /**
       * Attempt to bypass auth by setting a mock session
       * @example cy.loginBySession()
       * @example cy.loginBySession({ email: 'custom@example.com', name: 'Custom User' })
       */
      loginBySession(user?: { email: string; name: string }): Chainable<void>
    }
  }
}
