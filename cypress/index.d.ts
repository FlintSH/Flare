/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable {
    /**
     * Custom command to login via UI
     * @example cy.loginViaUI('email@example.com', 'password123')
     */
    loginViaUI(email: string, password: string): Chainable<void>

    /**
     * Custom command to bypass authentication by simulating a session
     * @example cy.loginBySession()
     * @example cy.loginBySession({ email: 'custom@example.com', name: 'Custom User' })
     */
    loginBySession(user?: { email: string; name: string }): Chainable<void>
  }
}
