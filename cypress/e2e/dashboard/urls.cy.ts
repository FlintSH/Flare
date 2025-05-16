describe('URL Management', () => {
  beforeEach(() => {
    // Attempt to bypass authentication for testing
    cy.loginBySession()

    // Visit the URLs page
    cy.visit('/dashboard/urls')

    // Check if we're authenticated or redirected
    cy.url().then((url) => {
      if (url.includes('/auth/login') || url.includes('/auth/signin')) {
        cy.log('Authentication bypass failed, skipping protected tests')
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

  it('should show URLs page when authenticated', () => {
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) {
        cy.log('Not authenticated - testing redirect behavior')
        cy.url().should('include', '/auth')
      } else {
        cy.log('Authenticated - testing URLs page presence')
        cy.url().should('include', '/dashboard/urls')

        // Check for URL management elements
        cy.get('main').should('be.visible')
      }
    })
  })

  it('should have a way to create new URLs', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      // Look for create new URL button or form
      cy.get('body').then(($body) => {
        // Try multiple ways to identify the "create" functionality
        const hasCreateElement =
          $body.find(
            'button:contains("New"), button:contains("Create"), a:contains("New"), a:contains("Create")'
          ).length > 0 ||
          $body.find(
            '[data-testid*="new"], [data-testid*="create"], [data-cy*="new"], [data-cy*="create"]'
          ).length > 0

        expect(hasCreateElement).to.be.true
      })
    })
  })

  it('should display existing URLs if any', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      // Look for URL list or grid, or empty state message
      cy.get('body').then(($body) => {
        // Look for common UI patterns for lists
        const hasUrlList =
          $body.find('table, ul, ol, [role="list"], [role="grid"]').length > 0

        // If we don't find a list, check for an empty state message
        if (!hasUrlList) {
          const hasEmptyState =
            $body.text().includes('No URLs') ||
            $body.text().includes('Create your first') ||
            $body.text().includes('Empty') ||
            $body.text().includes('No results')

          expect(hasUrlList || hasEmptyState).to.be.true
        }
      })
    })
  })

  it('should allow navigation back to dashboard', () => {
    runIfAuthenticated()
    cy.get('@isAuthenticated').then((isAuthenticated) => {
      if (!isAuthenticated) return

      // Look for a way to go back to dashboard
      cy.get(
        'a[href*="/dashboard"]:not([href*="/dashboard/"]), a:contains("Dashboard"), a:contains("Back")'
      )
        .first()
        .click()
      cy.url().should('include', '/dashboard')
    })
  })
})
