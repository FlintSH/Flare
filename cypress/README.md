# Cypress Tests for Flare Application

This directory contains the Cypress test suite for the Flare application. The tests are organized by feature area and include both end-to-end (E2E) tests and component tests.

## Directory Structure

```
cypress/
├── e2e/                 # End-to-end tests
│   ├── auth/            # Authentication tests (login, register)
│   ├── dashboard/       # Dashboard feature tests
│   └── navigation/      # Navigation and routing tests
├── fixtures/            # Test data
├── support/             # Support files and custom commands
│   ├── commands.ts      # Custom Cypress commands
│   ├── e2e.ts           # E2E test configuration
│   └── component.ts     # Component test configuration
└── index.d.ts           # TypeScript definitions for Cypress
```

## Available Tests

### Authentication Tests

- Login form validation and submission
- Registration form validation (when enabled)
- Authentication redirects

### Dashboard Tests

- Basic dashboard layout and navigation
- URL management features
- File upload interface

### Navigation Tests

- Basic navigation through the application
- Header/footer links

## Running Tests

To run the Cypress tests, you can use the following npm scripts:

```bash
# Open Cypress GUI
npm run cy:open

# Run all tests headlessly
npm run cy:run

# Run E2E tests with development server
npm run test:e2e

# Run component tests
npm run test:component
```

## Authentication in Tests

Most of the application features require authentication. The tests use two approaches:

1. `cy.loginViaUI()` - Uses the UI to log in with credentials
2. `cy.loginBySession()` - Attempts to bypass authentication by mocking the session

For protected routes, tests are written to be conditional and will check if authentication was successful before continuing.

## Adding New Tests

When adding new tests:

1. Place them in the appropriate directory based on feature
2. Use the existing patterns for conditional authentication
3. Make tests resilient to different UI states

## Fixtures

Fixtures in `cypress/fixtures/` provide test data. Current fixtures include:

- `users.json` - Test user credentials for authentication tests

## Custom Commands

Custom Cypress commands are defined in `cypress/support/commands.ts`:

- `cy.loginViaUI(email, password)` - Login through the UI
- `cy.loginBySession(user)` - Mock the authenticated session
