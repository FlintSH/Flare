# Cypress Testing Guide for Flare

## Overview

This guide provides instructions for running and extending the Cypress tests for the Flare application. The test suite covers authentication, dashboard functionality, navigation, and other core features.

## Prerequisites

- Node.js (same version as used in the project)
- npm
- Flare application code

## Running the Tests

### Starting the Application

Before running the tests, you need to have the application running locally:

```bash
# Start the Next.js development server
npm run dev
```

This will start the application on http://localhost:3000, which is the baseUrl configured in Cypress.

### Running Tests in Headless Mode

To run all tests in headless mode:

```bash
# Run all tests
npm run cy:run
```

To run a specific test file:

```bash
# Run a specific test file
npx cypress run --spec "cypress/e2e/navigation/basic-navigation.cy.ts"
```

### Running Tests with Interactive UI

To open the Cypress Test Runner:

```bash
npm run cy:open
```

This opens the Cypress UI where you can select which tests to run and see them execute in a browser window.

### Combining Server and Tests

For convenience, you can run both the development server and tests with a single command:

```bash
# Run the server and tests together
npm run test:e2e
```

This uses `start-server-and-test` to start the Next.js server, wait for it to be ready, and then run the Cypress tests.

## Test Structure

The tests are organized by feature area:

- `cypress/e2e/auth/` - Authentication tests (login, registration)
- `cypress/e2e/dashboard/` - Dashboard functionality tests
- `cypress/e2e/navigation/` - Basic navigation tests

## Authentication in Tests

Most of the application features require authentication. The tests handle this in two ways:

1. `cy.loginViaUI(email, password)` - Logs in through the UI
2. `cy.loginBySession(user)` - Attempts to bypass authentication by mocking the session

## Test Data

Test fixtures in `cypress/fixtures/` include:

- `users.json` - Test user credentials for authentication tests

## Troubleshooting

### Tests Failing to Connect to Server

If tests fail with `cy.visit()` errors:

1. Ensure the Next.js server is running (`npm run dev`)
2. Check that it's running on port 3000 (or update the baseUrl in cypress.config.ts)
3. Verify there are no network/firewall issues blocking connections

### Authentication Issues

If tests that require authentication are failing:

1. Check that the authentication bypass command (`loginBySession`) is compatible with your auth implementation
2. You may need to update the mock session data in the command

## Extending the Tests

### Adding New Tests

1. Create a new test file in the appropriate feature directory
2. Follow existing patterns for test structure
3. Use the conditional authentication pattern for protected routes
4. Use resilient selectors that can handle UI changes

### Using Custom Commands

Custom Cypress commands are in `cypress/support/commands.ts`:

```typescript
// Example usage of custom commands
cy.loginViaUI('user@example.com', 'password123')
cy.loginBySession({ email: 'test@example.com', name: 'Test User' })
```

## CI/CD Integration

To run tests in CI/CD environments:

1. Use `npm run cy:run` in your CI pipeline
2. Ensure the application server is started before tests run
3. Consider using Cypress GitHub integration for visual test results

## Best Practices

1. **Resilient Selectors**: Use data attributes (`data-testid="login-button"`) rather than classes or element types
2. **Independent Tests**: Each test should be independent and not rely on the state from other tests
3. **Conditional Testing**: Handle different UI states gracefully
4. **Mock External Dependencies**: Use Cypress's intercept capabilities to mock API calls
