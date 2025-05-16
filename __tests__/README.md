# API Test Suite

This directory contains the test suite for Flare's backend API endpoints. The test suite is built using Jest and provides comprehensive test coverage for the API routes.

## Directory Structure

- `__tests__/api/`: Contains test files for each API endpoint
- `__tests__/helpers/`: Contains helper functions for testing API routes
- `__tests__/setup.ts`: Test setup file and mocks initialization

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Writing API Tests

All API tests should follow the same pattern:

1. Import the necessary functions and helpers
2. Mock any required dependencies
3. Create test cases for each endpoint function (GET, POST, PUT, DELETE)
4. Include both success and error cases
5. Reset mocks between tests

### Example:

```typescript
import { GET, POST } from '@/app/api/users/route'
import { beforeEach, describe, expect, it } from '@jest/globals'

import {
  clearMocks,
  createRequest,
  mockAdminSession,
} from '../helpers/api-test-helper'
import { prisma } from '../setup'

describe('Users API', () => {
  beforeEach(() => {
    clearMocks()
  })

  describe('GET /api/users', () => {
    it('should return users list', async () => {
      mockAdminSession()

      // Mock data and API call here
      // Test response and assertions
    })
  })
})
```

## Mocking

The test suite uses several mocking strategies:

- **PrismaClient**: Mocked using jest-mock-extended
- **NextAuth**: Session management is mocked for auth testing
- **NextResponse**: Mocked for proper response testing
- **Storage providers**: Mocked to avoid actual file operations

## CI Integration

Tests are automatically run in CI/CD pipeline via GitHub Actions. The workflow is defined in `.github/workflows/test.yml`.
