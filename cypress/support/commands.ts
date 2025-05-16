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

// Custom command to login using UI
Cypress.Commands.add('loginViaUI', (email: string, password: string) => {
  cy.visit('/auth/login')
  cy.get('input[name="email"]').type(email)
  cy.get('input[name="password"]').type(password)
  cy.get('button[type="submit"]').click()
})

// Custom command to login by mocking the session
// This is useful for testing protected routes without a real login
Cypress.Commands.add(
  'loginBySession',
  (user = { email: 'test@example.com', name: 'Test User' }) => {
    // Store the user in localStorage to simulate being logged in
    // This assumes the app is using localStorage for session management
    // If the app uses HTTP-only cookies or other methods, this won't work
    cy.log('Attempting to bypass authentication for testing')

    // Try multiple approaches as we don't know exactly how the auth is implemented

    // Approach 1: Check if app uses Next-Auth
    cy.window().then((win) => {
      // For Next-Auth
      const nextAuthSessionKey = Object.keys(win.localStorage).find(
        (key) =>
          key.startsWith('next-auth.session-token') || key.includes('next-auth')
      )

      if (nextAuthSessionKey) {
        cy.log('Found Next-Auth session key, setting mock session')

        const mockSession = {
          user,
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 1 day from now
        }

        win.localStorage.setItem(
          'next-auth.session-token',
          JSON.stringify(mockSession)
        )
        return
      }

      // Approach 2: Generic JWT token approach
      cy.log('Setting generic mock token for testing')
      win.localStorage.setItem('token', 'mock-jwt-token-for-testing')
      win.localStorage.setItem('user', JSON.stringify(user))
    })

    // After setting mock auth data, visit the dashboard
    cy.visit('/dashboard')
  }
)

// Declare the Cypress namespace to add the custom commands
declare global {
  namespace Cypress {
    interface Chainable {
      loginViaUI(email: string, password: string): Chainable<void>
      loginBySession(user?: { email: string; name: string }): Chainable<void>
    }
  }
}
