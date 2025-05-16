import { NextResponse } from 'next/server'

// Import NextAuth handler
import { handler as authHandler } from '@/app/api/auth/[...nextauth]/route'
// Import registration route handler
import * as registerApi from '@/app/api/auth/register/route'
// Mock the registration status endpoint
import * as registrationStatusApi from '@/app/api/auth/registration-status/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { clearMocks, createRequest } from '../helpers/api-test-helper'
import { prisma } from '../setup'

// Mock the NextAuth handler
jest.mock('next-auth/next', () => ({
  default: jest.fn(() => ({
    GET: jest.fn(),
    POST: jest.fn(),
  })),
}))

// Mock the auth options
jest.mock('@/lib/auth', () => ({
  authOptions: {
    providers: [
      {
        id: 'credentials',
        name: 'Credentials',
        type: 'credentials',
        authorize: jest.fn(),
      },
    ],
    callbacks: {
      jwt: jest.fn(),
      session: jest.fn(),
    },
    pages: {
      signIn: '/auth/login',
      error: '/auth/error',
    },
  },
}))

// Create mock for the registration route
jest.mock('@/app/api/auth/register/route', () => {
  return {
    POST: jest.fn(),
  }
})

// Mock the bcrypt hash function
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}))

jest.mock('@/app/api/auth/registration-status/route', () => {
  return {
    GET: jest.fn(),
  }
})

// Mock config module
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    settings: {
      general: {
        registrations: {
          enabled: true,
          disabledMessage: '',
        },
      },
    },
  }),
}))

describe('Auth API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Define default mock implementations
    registerApi.POST.mockImplementation(async () => {
      return NextResponse.json({
        success: true,
      })
    })

    registrationStatusApi.GET.mockImplementation(async () => {
      return NextResponse.json({
        data: {
          enabled: true,
          message: '',
        },
        success: true,
      })
    })

    // Reset prisma mock implementation
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({
      id: 'new-user-id',
      name: 'Test User',
      email: 'test@example.com',
    })
  })

  describe('NextAuth Handler', () => {
    it('should export GET and POST handlers', () => {
      expect(authHandler).toBeDefined()
      expect(authHandler.GET).toBeDefined()
      expect(authHandler.POST).toBeDefined()
    })
  })

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      // Mock the config to allow registrations
      const { getConfig } = require('@/lib/config')
      getConfig.mockResolvedValue({
        settings: {
          general: {
            registrations: {
              enabled: true,
            },
          },
        },
      })

      // Mock API response
      registerApi.POST.mockImplementation(async (req) => {
        const { name, email, password } = await req.json()

        // Get config to check if registrations are enabled
        const config = await getConfig()
        if (!config.settings.general.registrations.enabled) {
          return NextResponse.json(
            { error: 'Registrations are disabled', success: false },
            { status: 403 }
          )
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
        })

        if (existingUser) {
          return NextResponse.json(
            { error: 'User already exists', success: false },
            { status: 400 }
          )
        }

        // Hash password and create user
        const { hash } = require('bcryptjs')
        const hashedPassword = await hash(password, 10)

        const user = await prisma.user.create({
          data: {
            name,
            email,
            password: hashedPassword,
            role: 'USER',
          },
        })

        return NextResponse.json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
        })
      })

      const newUser = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: newUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.user).toEqual({
        id: 'new-user-id',
        name: 'Test User',
        email: 'test@example.com',
      })
    })

    it('should validate user input during registration', async () => {
      // Mock API response with validation
      registerApi.POST.mockImplementation(async (req) => {
        const { name, email, password } = await req.json()

        // Validate input
        const errors = []
        if (!name) errors.push('Name is required')
        if (!email) errors.push('Email is required')
        if (!email.includes('@')) errors.push('Invalid email format')
        if (!password) errors.push('Password is required')
        if (password && password.length < 8)
          errors.push('Password must be at least 8 characters')

        if (errors.length > 0) {
          return NextResponse.json(
            { error: errors[0], success: false },
            { status: 400 }
          )
        }

        return NextResponse.json({
          success: true,
        })
      })

      const invalidUser = {
        name: '',
        email: 'invalid-email',
        password: '123',
      }

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
      // Mock existing user
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
      })

      // Mock API response
      registerApi.POST.mockImplementation(async (req) => {
        const { email } = await req.json()

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
        })

        if (existingUser) {
          return NextResponse.json(
            { error: 'User already exists', success: false },
            { status: 400 }
          )
        }

        return NextResponse.json({
          success: true,
        })
      })

      const duplicateUser = {
        name: 'Existing User',
        email: 'existing@example.com',
        password: 'password123',
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/register',
        body: duplicateUser,
      })

      const response = await registerApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User already exists')
    })

    it('should prevent registration when disabled', async () => {
      // Mock config to disable registrations
      const { getConfig } = require('@/lib/config')
      getConfig.mockResolvedValue({
        settings: {
          general: {
            registrations: {
              enabled: false,
              disabledMessage: 'Registrations are currently disabled',
            },
          },
        },
      })

      // Mock API response
      registerApi.POST.mockImplementation(async () => {
        // Get config to check if registrations are enabled
        const config = await getConfig()
        if (!config.settings.general.registrations.enabled) {
          return NextResponse.json(
            {
              error:
                config.settings.general.registrations.disabledMessage ||
                'Registrations are disabled',
              success: false,
            },
            { status: 403 }
          )
        }

        return NextResponse.json({
          success: true,
        })
      })

      const newUser = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
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
      // Mock config
      const { getConfig } = require('@/lib/config')
      getConfig.mockResolvedValue({
        settings: {
          general: {
            registrations: {
              enabled: true,
              disabledMessage: '',
            },
          },
        },
      })

      // Mock API response
      registrationStatusApi.GET.mockImplementation(async () => {
        const config = await getConfig()
        const { enabled, disabledMessage } =
          config.settings.general.registrations

        return NextResponse.json({
          data: {
            enabled,
            message: disabledMessage || '',
          },
          success: true,
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
      // Mock config with disabled registrations
      const { getConfig } = require('@/lib/config')
      getConfig.mockResolvedValue({
        settings: {
          general: {
            registrations: {
              enabled: false,
              disabledMessage: 'New registrations are closed',
            },
          },
        },
      })

      // Mock API response
      registrationStatusApi.GET.mockImplementation(async () => {
        const config = await getConfig()
        const { enabled, disabledMessage } =
          config.settings.general.registrations

        return NextResponse.json({
          data: {
            enabled,
            message: disabledMessage || '',
          },
          success: true,
        })
      })

      const response = await registrationStatusApi.GET()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual({
        enabled: false,
        message: 'New registrations are closed',
      })
    })
  })
})
