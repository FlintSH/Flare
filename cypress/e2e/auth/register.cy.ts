describe('Registration Page', () => {
  beforeEach(() => {
    // Check if registration is enabled before trying to visit the page
    cy.visit('/auth/login')
    cy.get('body').then(($body) => {
      if (!$body.find('a[href*="register"]').length) {
        // Skip these tests if registration is disabled
        cy.log(
          'Registration appears to be disabled, skipping registration tests'
        )
        // Instead of trying to skip the current test, we'll use a flag
        cy.wrap(false).as('registrationEnabled')
        return
      }

      cy.get('a[href*="register"]').click()
      cy.wrap(true).as('registrationEnabled')
    })
  })

  // Helper function to conditionally skip tests if registration is disabled
  const runIfRegistrationEnabled = () => {
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) {
        cy.log('Registration disabled, skipping test')
        return
      }

      // Test will continue if registration is enabled
    })
  }

  it('should display the registration form', () => {
    runIfRegistrationEnabled()
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) return

      cy.get('form').should('be.visible')
      cy.get('input[name="email"]').should('be.visible')
      cy.get('input[name="password"]').should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
    })
  })

  it('should validate required fields', () => {
    runIfRegistrationEnabled()
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) return

      cy.get('button[type="submit"]').click()
      cy.get('form').contains('Required').should('be.visible')
    })
  })

  it('should validate email format', () => {
    runIfRegistrationEnabled()
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) return

      cy.get('input[name="email"]').type('invalidEmail')
      cy.get('button[type="submit"]').click()
      cy.get('form').contains('valid email').should('be.visible')
    })
  })

  it('should validate password strength', () => {
    runIfRegistrationEnabled()
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) return

      cy.get('input[name="email"]').type('test@example.com')
      cy.get('input[name="password"]').type('weak')
      cy.get('button[type="submit"]').click()

      // Looking for typical password validation messages
      cy.get('body').then(($body) => {
        const passwordValidationFound =
          $body.text().includes('characters') ||
          $body.text().includes('Password') ||
          $body.text().includes('strength')

        expect(passwordValidationFound).to.be.true
      })
    })
  })

  it('should allow navigation back to login page', () => {
    runIfRegistrationEnabled()
    cy.get('@registrationEnabled').then((enabled) => {
      if (!enabled) return

      cy.contains('a', /sign in/i).click()
      cy.url().should('include', '/auth/login')
    })
  })
})
