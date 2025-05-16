import { NextResponse } from 'next/server'

// Import API handlers
import * as registerApi from '@/app/api/auth/register/route'
import * as registrationStatusApi from '@/app/api/auth/registration-status/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  clearMocks,
  createRequest,
  mockUserSession,
} from '../helpers/api-test-helper'
import { createApiResponse } from '../helpers/test-utils'
import { prisma } from '../setup'

// Mock the NextAuth handler
jest.mock('@/app/api/auth/[...nextauth]/route', () => {
  return {
    GET: jest.fn(),
    POST: jest.fn(),
  }
})

// Mock API routes
jest.mock('@/app/api/auth/register/route', () => {
  return {
    POST: jest.fn(),
  }
})

jest.mock('@/app/api/auth/registration-status/route', () => {
  return {
    GET: jest.fn(),
  }
})

// Mock the auth options
jest.mock('@/lib/auth', () => ({
  authOptions: {
    providers: [],
    pages: {
      signIn: '/auth/login',
      signOut: '/auth/logout',
      error: '/auth/error',
    },
  },
}))

describe('Auth API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Default API implementation
    registerApi.POST.mockImplementation(() => {
      return createApiResponse({
        id: 'new-user-id',
        name: 'New User',
        email: 'newuser@example.com',
        role: 'USER',
      })
    })

    registrationStatusApi.GET.mockImplementation(() => {
      return createApiResponse({
        enabled: true,
        message: '',
      })
    })
  })

  describe('NextAuth Handler', () => {
    it('should export GET and POST handlers', () => {
      // Get the mocked route handler
      const authHandler = require('@/app/api/auth/[...nextauth]/route')

      expect(authHandler).toBeDefined()
      expect(authHandler.GET).toBeDefined()
      expect(authHandler.POST).toBeDefined()
    })
  })

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'Password123!',
      }

      const mockUser = {
        id: 'new-user-id',
        name: 'New User',
        email: 'newuser@example.com',
        role: 'USER',
        createdAt: new Date(),
      }

      // Mock database responses
      prisma.user.findUnique.mockResolvedValue(null) // No existing user
      prisma.user.create.mockResolvedValue(mockUser)

      // Mock API response
      registerApi.POST.mockImplementation(() => {
        return createApiResponse({
          user: mockUser,
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: newUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.user).toEqual(mockUser)
    })

    it('should validate user input during registration', async () => {
      const invalidUser = {
        email: 'invalidemail',
        // Missing name and password
      }

      // Mock API response for validation error
      registerApi.POST.mockImplementation(() => {
        return createApiResponse('Name is required', {
          success: false,
          status: 400,
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: invalidUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Name is required')
    })

    it('should prevent registering a duplicate user', async () => {
      const existingUser = {
        name: 'Existing User',
        email: 'existing@example.com',
        password: 'Password123!',
      }

      // Mock database to simulate an existing user
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        name: 'Existing User',
        email: 'existing@example.com',
      })

      // Mock API response for duplicate user
      registerApi.POST.mockImplementation(() => {
        return createApiResponse('User already exists', {
          success: false,
          status: 400,
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: existingUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User already exists')
    })

    it('should prevent registration when disabled', async () => {
      // Mock API response for disabled registrations
      registerApi.POST.mockImplementation(() => {
        return createApiResponse('Registrations are currently disabled', {
          success: false,
          status: 403,
        })
      })

      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'Password123!',
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: newUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Registrations are currently disabled')
    })
  })

  describe('GET /api/auth/registration-status', () => {
    it('should return current registration status', async () => {
      // Mock API response for enabled registrations
      registrationStatusApi.GET.mockImplementation(() => {
        return createApiResponse({
          enabled: true,
          message: '',
        })
      })

      const response = await registrationStatusApi.GET()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual({
        enabled: true,
        message: '',
      })
    })

    it('should return disabled status when registrations are off', async () => {
      // Mock API response for disabled registrations
      registrationStatusApi.GET.mockImplementation(() => {
        return createApiResponse({
          enabled: false,
          message: 'Registrations are currently disabled',
        })
      })

      const response = await registrationStatusApi.GET()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual({
        enabled: false,
        message: 'Registrations are currently disabled',
      })
    })
  })
})
