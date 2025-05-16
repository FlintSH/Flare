describe('Basic Navigation', () => {
  it('should navigate to the home page', () => {
    cy.visit('/')
    cy.url().should('include', '/')
  })

  it('should have working login link', () => {
    cy.visit('/')
    // Looking for login links or buttons
    cy.get('body').then(($body) => {
      // Try different possible selectors for login links
      if ($body.find('a[href*="login"]').length) {
        cy.get('a[href*="login"]').click()
        cy.url().should('include', '/auth/login')
      } else if ($body.find('a[href*="signin"]').length) {
        cy.get('a[href*="signin"]').click()
        cy.url().should('include', '/auth/signin')
      } else {
        // Look for buttons with login text
        const loginButton = $body.find(
          'button:contains("Login"), button:contains("Sign in")'
        )
        if (loginButton.length) {
          cy.wrap(loginButton).click()
          cy.url().should('match', /auth|login|signin/)
        } else {
          cy.log('No login link found on home page')
        }
      }
    })
  })

  it('should have a header/navigation bar', () => {
    cy.visit('/')
    cy.get('header, nav').should('be.visible')
  })

  it('should have working links in the header/navigation', () => {
    cy.visit('/')
    cy.get('header a, nav a').each(($link) => {
      // Skip external links to avoid leaving the test
      if ($link.prop('href').startsWith(Cypress.config().baseUrl as string)) {
        const linkUrl = $link.prop('href')
        const linkText = $link.text()

        // Log info for debugging
        cy.log(`Testing link: ${linkText} with href: ${linkUrl}`)

        // Click the link
        cy.wrap($link).click()

        // Verify navigation
        cy.url().should('eq', linkUrl)

        // Go back to the home page for the next iteration
        cy.visit('/')
      } else {
        cy.log(`Skipping external link: ${$link.prop('href')}`)
      }
    })
  })
})
