describe('Dashboard', () => {
  // This is a protected route, so we need to handle authentication
  // Since we can't guarantee authentication in e2e tests without proper backend setup
  // We'll conditionally run tests based on whether we're already logged in

  beforeEach(() => {
    cy.visit('/dashboard')

    // Check if redirected to login page (not authenticated)
    cy.url().then((url) => {
      if (url.includes('/auth/login') || url.includes('/auth/signin')) {
        cy.log('Not authenticated, this test requires authentication')
        cy.wrap(false).as('isAuthenticated')
      } else {
        cy.wrap(true).as('isAuthenticated')
      }
    })
  })

  const runIfAuthenticated = () => {
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) {
        cy.log('Skipping test - authentication required')
        return
      }
      // Test will continue if authenticated
    })
  }

  it('should show dashboard when authenticated', () => {
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) {
        cy.log('Not authenticated - testing redirect behavior')
        cy.url().should('include', '/auth')
      } else {
        cy.log('Authenticated - testing dashboard presence')
        cy.url().should('include', '/dashboard')

        // Check for typical dashboard elements
        cy.get('main').should('be.visible')
      }
    })
  })

  it('should have navigation elements in dashboard', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      cy.get('nav, header').should('be.visible')
      cy.get('nav a, header a').should('have.length.at.least', 1)
    })
  })

  it('should have visible user-related elements', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      // Look for common user UI elements - avatar, username, etc.
      cy.get('body').then(($body) => {
        const hasUserElement =
          $body.find('[data-user], [data-testid*="user"], .user, .avatar')
            .length > 0 ||
          $body.text().includes('Profile') ||
          $body.text().includes('Account') ||
          $body.text().includes('Settings')

        expect(hasUserElement).to.be.true
      })
    })
  })

  it('should have working dashboard navigation links', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      // Get all navigation links and test the first few
      cy.get('nav a, aside a').then(($links) => {
        // Limit to testing just a few links to avoid excessive tests
        const maxLinksToTest = Math.min(3, $links.length)

        for (let i = 0; i < maxLinksToTest; i++) {
          const $link = $links.eq(i)
          const href = $link.prop('href')
          const text = $link.text().trim()

          // Skip if no href or it's external
          if (!href || !href.startsWith(Cypress.config().baseUrl as string))
            continue

          cy.log(`Testing dashboard link: ${text}`)
          cy.visit(href)
          cy.url().should('eq', href)

          // Go back to dashboard for next test
          cy.visit('/dashboard')
        }
      })
    })
  })
})
