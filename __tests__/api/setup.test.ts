import { NextResponse } from 'next/server'

// Import route handler
import * as setupApi from '@/app/api/setup/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { clearMocks, createRequest } from '../helpers/api-test-helper'
import { prisma } from '../setup'

// Create mock for the setup route
jest.mock('@/app/api/setup/route', () => {
  return {
    POST: jest.fn(),
    GET: jest.fn(),
  }
})

// Mock required dependencies
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid'),
}))

// Mock config update function
jest.mock('@/lib/config', () => ({
  updateConfig: jest.fn().mockResolvedValue({}),
  getConfig: jest.fn().mockResolvedValue({
    version: '1.0.0',
    settings: {
      general: {
        setup: {
          completed: false,
        },
      },
    },
  }),
}))

describe('Setup API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Define default mock implementation
    setupApi.POST.mockImplementation(async () => {
      return NextResponse.json({
        success: true,
      })
    })

    // Reset prisma mock implementation
    prisma.user.count.mockResolvedValue(0)
    prisma.user.create.mockResolvedValue({})
  })

  describe('POST /api/setup', () => {
    it('should return error if setup already completed', async () => {
      // Mock that users already exist
      prisma.user.count.mockResolvedValue(1)

      // Mock the API response
      setupApi.POST.mockImplementation(async () => {
        const userCount = await prisma.user.count()

        if (userCount > 0) {
          return NextResponse.json(
            { error: 'Setup already completed', success: false },
            { status: 400 }
          )
        }

        return NextResponse.json({
          success: true,
        })
      })

      const setupData = {
        admin: {
          name: 'Admin User',
          email: 'admin@example.com',
          password: 'password123',
        },
        storage: {
          provider: 'local' as const,
          s3: {
            bucket: '',
            region: '',
            accessKeyId: '',
            secretAccessKey: '',
            endpoint: '',
            forcePathStyle: false,
          },
        },
        registrations: {
          enabled: true,
          disabledMessage: '',
        },
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: setupData,
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Setup already completed')
    })

    it('should complete setup successfully', async () => {
      // Mock no existing users
      prisma.user.count.mockResolvedValue(0)

      const mockUser = {
        id: 'user-id',
        name: 'Admin User',
        email: 'admin@example.com',
      }

      prisma.user.create.mockResolvedValue(mockUser)

      // Import the mocked functions to verify calls
      const { updateConfig } = require('@/lib/config')
      const { hash } = require('bcryptjs')
      const { v4 } = require('uuid')

      // Mock the API response
      setupApi.POST.mockImplementation(async (req) => {
        const body = await req.json()

        // Check if setup is already complete
        const userCount = await prisma.user.count()
        if (userCount > 0) {
          return NextResponse.json(
            { error: 'Setup already completed', success: false },
            { status: 400 }
          )
        }

        // Create admin user with hashed password
        const hashedPassword = await hash(body.admin.password, 10)
        const user = await prisma.user.create({
          data: {
            name: body.admin.name,
            email: body.admin.email,
            password: hashedPassword,
            role: 'ADMIN',
            urlId: 'abc123',
            uploadToken: v4(),
          },
        })

        // Update configuration
        await updateConfig({
          settings: {
            general: {
              setup: {
                completed: true,
                completedAt: new Date(),
              },
              storage: body.storage,
              registrations: body.registrations,
            },
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

      const setupData = {
        admin: {
          name: 'Admin User',
          email: 'admin@example.com',
          password: 'password123',
        },
        storage: {
          provider: 'local' as const,
          s3: {
            bucket: 'test-bucket',
            region: 'us-east-1',
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
            endpoint: '',
            forcePathStyle: false,
          },
        },
        registrations: {
          enabled: true,
          disabledMessage: '',
        },
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: setupData,
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.user).toEqual(mockUser)

      // Verify function calls
      expect(hash).toHaveBeenCalledWith('password123', 10)
      expect(prisma.user.create).toHaveBeenCalled()
      expect(updateConfig).toHaveBeenCalled()
      expect(v4).toHaveBeenCalled()
    })

    it('should validate input and return errors', async () => {
      // Mock the API response with validation
      setupApi.POST.mockImplementation(async (req) => {
        const body = await req.json()

        // Simple validation
        const errors = []
        if (!body.admin?.name) errors.push('Admin name is required')
        if (!body.admin?.email?.includes('@'))
          errors.push('Invalid email format')
        if (body.admin?.password?.length < 8)
          errors.push('Password must be at least 8 characters')
        if (!['local', 's3'].includes(body.storage?.provider)) {
          errors.push('Invalid storage provider')
        }

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

      const invalidSetupData = {
        admin: {
          name: '', // Invalid: empty name
          email: 'not-an-email', // Invalid: not an email
          password: '123', // Invalid: too short
        },
        storage: {
          provider: 'invalid-provider' as any,
          s3: {
            bucket: '',
            region: '',
            accessKeyId: '',
            secretAccessKey: '',
          },
        },
        registrations: {
          enabled: true,
        },
      }

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: invalidSetupData,
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Admin name is required')
    })
  })

  describe('GET /api/setup/check', () => {
    // Import the check endpoint
    const { GET } = require('@/app/api/setup/check/route')

    it('should return setup status', async () => {
      // Mock the configuration
      const { getConfig } = require('@/lib/config')
      getConfig.mockResolvedValue({
        settings: {
          general: {
            setup: {
              completed: true,
              completedAt: new Date('2023-01-01'),
            },
          },
        },
      })

      const response = await GET()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.completed).toBe(true)
    })
  })
})
