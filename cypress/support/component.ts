// ***********************************************************
// This is support file for component testing
// ***********************************************************
import '@testing-library/cypress/add-commands'
import { mount } from 'cypress/react'

import './commands'

// Augment the Cypress namespace to include mount
declare global {
  namespace Cypress {
    interface Chainable {
      mount: typeof mount
    }
  }
}

Cypress.Commands.add('mount', mount)

// Example use:
// cy.mount(<MyComponent />)
