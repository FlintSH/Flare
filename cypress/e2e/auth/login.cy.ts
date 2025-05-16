describe('Login Page', () => {
  beforeEach(() => {
    cy.visit('/auth/login')
  })

  it('should display the login form', () => {
    cy.get('form').should('be.visible')
    cy.get('input[name="email"]').should('be.visible')
    cy.get('input[name="password"]').should('be.visible')
    cy.get('button[type="submit"]').should('be.visible')
  })

  it('should validate required fields', () => {
    cy.get('button[type="submit"]').click()
    cy.get('form').contains('Required').should('be.visible')
  })

  it('should validate email format', () => {
    cy.get('input[name="email"]').type('invalidEmail')
    cy.get('button[type="submit"]').click()
    cy.get('form').contains('valid email').should('be.visible')
  })

  it('should navigate to registration page if link is available', () => {
    // This checks if the registration link exists and clicks it if it does
    cy.get('body').then(($body) => {
      if ($body.find('a[href*="register"]').length) {
        cy.get('a[href*="register"]').click()
        cy.url().should('include', '/auth/register')
      } else {
        // Skip the test if registration is disabled
        cy.log('Registration link not found, possibly disabled')
      }
    })
  })

  it('should display error message with incorrect credentials', () => {
    cy.fixture('users.json').then((users) => {
      cy.get('input[name="email"]').type(users.invalidUser.email)
      cy.get('input[name="password"]').type(users.invalidUser.password)
      cy.get('button[type="submit"]').click()

      // Wait for the error message to appear
      cy.contains('Invalid email or password').should('be.visible')
    })
  })

  // Note: We can't reliably test successful login in E2E tests without setting up
  // proper test database seeding or mocking authentication endpoints
})
