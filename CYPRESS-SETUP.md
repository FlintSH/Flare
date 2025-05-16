# Cypress Test Suite Setup for Flare Application

## Overview

This document describes the Cypress test suite that has been set up for the Flare Next.js application. The test suite is structured to handle both authenticated and unauthenticated scenarios, and includes tests for key application features.

## Setup Steps Completed

1. **Installed Required Dependencies**

   - Cypress
   - @testing-library/cypress
   - start-server-and-test

2. **Updated package.json with Cypress Scripts**

   ```json
   "cy:open": "cypress open",
   "cy:run": "cypress run",
   "test": "cypress run",
   "test:e2e": "start-server-and-test dev http://localhost:3000 cy:run",
   "test:component": "cypress run --component"
   ```

3. **Created Configuration Files**

   - `cypress.config.ts` - Main Cypress configuration
   - Support files structure in `cypress/support/`
   - Type definitions in `cypress/index.d.ts`

4. **Created Test Structure**

   - Organized tests by feature area (`auth`, `dashboard`, `navigation`)
   - Created test fixtures in `cypress/fixtures/`
   - Added README with documentation

5. **Implemented Custom Commands**
   - `loginViaUI` - Login through the UI flow
   - `loginBySession` - Attempt to bypass authentication for testing

## Test Categories

### Authentication Tests

- Login form validation and submission
- Registration form validation (when enabled)
- Authentication error states

### Dashboard Tests

- Dashboard layout and navigation
- URL management feature tests
- File upload interface tests

### Navigation Tests

- Basic navigation
- Header/footer links

## Running the Tests

To run the tests, you need to have the application running:

```bash
# In one terminal, start the Next.js dev server
npm run dev

# In another terminal, run Cypress tests
npm run cy:run
```

Alternatively, use the combined command:

```bash
npm run test:e2e
```

## Test Strategy

The tests are designed to work in different environments:

1. **Conditional Testing** - Tests check their current state and adapt accordingly (e.g., if not authenticated, test the redirect behavior instead)

2. **Authentication Handling** - Two approaches to handle authentication:

   - UI-based login
   - Session mocking for protected routes

3. **Resilient Selectors** - Tests use multiple selector strategies to find elements, making them more resilient to UI changes

## Next Steps

1. **Database Seeding** - Add capabilities to seed test data for more comprehensive testing

2. **API Mocking** - Implement API mocking for tests that require backend interactions

3. **CI Integration** - Set up Cypress to run in CI/CD pipeline

4. **Visual Testing** - Add visual regression testing for key components

5. **Expand Test Coverage** - Add more tests for other features of the application
