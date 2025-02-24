import '@testing-library/jest-dom'
import mockRouter from 'next-router-mock'

// Mock next/router
jest.mock('next/router', () => mockRouter)

// Suppress console errors during tests
beforeAll(() => {
  console.error = jest.fn()
})

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks()
})
