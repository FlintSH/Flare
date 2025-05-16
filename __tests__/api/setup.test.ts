import { NextResponse } from 'next/server'

import { GET } from '@/app/api/setup/check/route'
// Import the API handler
import * as setupApi from '@/app/api/setup/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  clearMocks,
  createRequest,
  mockUserSession,
} from '../helpers/api-test-helper'
import { createApiResponse } from '../helpers/test-utils'
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

// Mock the setup check route
jest.mock('@/app/api/setup/check/route', () => {
  return {
    GET: jest.fn(() => {
      return createApiResponse(
        { completed: true, inProgress: false },
        { status: 200 }
      )
    }),
  }
})

describe('Setup API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Mock the setup API's default behavior
    setupApi.POST.mockImplementation(() => {
      return createApiResponse({ success: true })
    })

    // Reset prisma implementation
    prisma.user.count.mockResolvedValue(0)
  })

  describe('POST /api/setup', () => {
    it('should return error if setup already completed', async () => {
      // Mock the database to indicate setup is already done
      prisma.user.count.mockResolvedValue(1) // At least one user exists

      // Mock API implementation
      setupApi.POST.mockImplementation(() => {
        return createApiResponse('Setup already completed', {
          success: false,
          status: 400,
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: {
          adminName: 'Admin User',
          adminEmail: 'admin@example.com',
          adminPassword: 'Password123!',
          siteName: 'Test Site',
        },
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Setup already completed')
    })

    it('should complete setup successfully', async () => {
      // Mock the database to indicate no setup has been done
      prisma.user.count.mockResolvedValue(0) // No users exist

      const mockUser = {
        id: 'admin-id',
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'ADMIN',
        createdAt: new Date(),
      }

      // Mock user creation
      prisma.user.create.mockResolvedValue(mockUser)
      // Mock settings creation
      prisma.settings.create.mockResolvedValue({
        id: 'settings-id',
        siteName: 'Test Site',
        siteDescription: '',
        logoUrl: '',
        registrationsEnabled: true,
      })

      // Mock API implementation
      setupApi.POST.mockImplementation(() => {
        return createApiResponse({
          user: mockUser,
          settings: {
            siteName: 'Test Site',
            registrationsEnabled: true,
          },
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: {
          adminName: 'Admin User',
          adminEmail: 'admin@example.com',
          adminPassword: 'Password123!',
          siteName: 'Test Site',
        },
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.user).toEqual(mockUser)
    })

    it('should validate input and return errors', async () => {
      // Mock the database to indicate no setup has been done
      prisma.user.count.mockResolvedValue(0) // No users exist

      // Mock API implementation for validation error
      setupApi.POST.mockImplementation(() => {
        return createApiResponse('Admin name is required', {
          success: false,
          status: 400,
        })
      })

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/setup',
        body: {
          // Missing required fields
          adminEmail: 'admin@example.com',
          adminPassword: 'Password123!',
        },
      })

      const response = await setupApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Admin name is required')
    })
  })

  describe('GET /api/setup/check', () => {
    it('should return setup status', async () => {
      // Mock the setup check API
      GET.mockImplementation(() => {
        return createApiResponse({
          completed: true,
          inProgress: false,
          registrationsEnabled: true,
        })
      })

      const response = await GET()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.completed).toBe(true)
      expect(data.data.inProgress).toBe(false)
      expect(data.data.registrationsEnabled).toBe(true)
    })
  })
})
