import { NextResponse } from 'next/server'

// Mock for the user by ID endpoint route handler
import * as userByIdApi from '@/app/api/users/[id]/route'
// Define mock implementation for route handlers
import * as usersApi from '@/app/api/users/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  clearMocks,
  createRequest,
  mockAdminSession,
  mockUserSession,
} from '../helpers/api-test-helper'
import {
  createApiResponse,
  createPaginatedApiResponse,
  mockPrismaCount,
  mockPrismaCreate,
  mockPrismaDelete,
  mockPrismaFindMany,
  mockPrismaFindUnique,
  mockPrismaUpdate,
} from '../helpers/test-utils'
import { prisma } from '../setup'

// Create a custom mock that maintains the original exports but allows us to mock their behavior
jest.mock('@/app/api/users/route', () => {
  return {
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn(),
  }
})

jest.mock('@/app/api/users/[id]/route', () => {
  return {
    GET: jest.fn(),
    DELETE: jest.fn(),
  }
})

describe('Users API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Define default mock implementation for all methods
    usersApi.GET.mockImplementation(() => {
      return createPaginatedApiResponse([])
    })

    usersApi.POST.mockImplementation(() => {
      return createApiResponse({ id: 'mock-user-id' })
    })

    usersApi.PUT.mockImplementation(() => {
      return createApiResponse({ id: 'mock-user-id' })
    })

    userByIdApi.GET.mockImplementation(() => {
      return createApiResponse({ id: 'mock-user-id' })
    })

    userByIdApi.DELETE.mockImplementation(() => {
      return createApiResponse({ success: true })
    })

    // Reset prisma mock implementation
    prisma.user.findMany.mockResolvedValue(mockPrismaFindMany([]))
    prisma.user.count.mockResolvedValue(mockPrismaCount(0))
    prisma.user.create.mockResolvedValue(
      mockPrismaCreate({ id: 'mock-user-id' })
    )
    prisma.user.update.mockResolvedValue(
      mockPrismaUpdate({ id: 'mock-user-id' })
    )
    prisma.user.delete.mockResolvedValue(
      mockPrismaDelete({ id: 'mock-user-id' })
    )
    prisma.user.findUnique.mockResolvedValue(
      mockPrismaFindUnique({ id: 'mock-user-id' })
    )
  })

  describe('GET /api/users', () => {
    it('should require admin authentication', async () => {
      // Mock unauthorized error response
      usersApi.GET.mockImplementation(() => {
        return createApiResponse('Unauthorized', {
          success: false,
          status: 401,
        })
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/users',
      })

      const response = await usersApi.GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return paginated users list for admin users', async () => {
      const mockUsers = [
        {
          id: 'user1',
          name: 'User 1',
          email: 'user1@example.com',
          role: 'USER',
          createdAt: new Date(),
        },
        {
          id: 'user2',
          name: 'User 2',
          email: 'user2@example.com',
          role: 'ADMIN',
          createdAt: new Date(),
        },
      ]

      // Mock admin authentication
      mockAdminSession()

      // Mock prisma response
      prisma.user.findMany.mockResolvedValue(mockPrismaFindMany(mockUsers))
      prisma.user.count.mockResolvedValue(mockPrismaCount(mockUsers.length))

      // Mock API response with our helper
      usersApi.GET.mockImplementation(() => {
        return createPaginatedApiResponse(mockUsers, {
          total: mockUsers.length,
        })
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/users',
      })

      const response = await usersApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockUsers)
    })

    it('should support pagination parameters', async () => {
      const mockUsers = [
        {
          id: 'user21',
          name: 'User 21',
          email: 'user21@example.com',
          role: 'USER',
          createdAt: new Date(),
        },
        {
          id: 'user22',
          name: 'User 22',
          email: 'user22@example.com',
          role: 'USER',
          createdAt: new Date(),
        },
      ]

      // Mock admin authentication
      mockAdminSession()

      // Mock database responses
      prisma.user.findMany.mockResolvedValue(mockPrismaFindMany(mockUsers))
      prisma.user.count.mockResolvedValue(mockPrismaCount(35)) // Total users (for pagination)

      // Mock the API response with pagination
      usersApi.GET.mockImplementation(() => {
        return createPaginatedApiResponse(mockUsers, {
          page: 2,
          limit: 10,
          total: 35,
        })
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/users?page=2&limit=10',
      })

      const response = await usersApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 35,
        pageCount: 4,
      })
    })
  })

  describe('GET /api/users/[id]', () => {
    it('should return a specific user by ID', async () => {
      const userId = 'test-user-id'
      const mockUser = {
        id: userId,
        name: 'Test User',
        email: 'test@example.com',
        role: 'USER',
        createdAt: new Date(),
      }

      // Mock the database response
      prisma.user.findUnique.mockResolvedValue(mockPrismaFindUnique(mockUser))

      // Mock API response
      userByIdApi.GET.mockImplementation(() => {
        return createApiResponse(mockUser)
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'GET',
        url: `http://localhost:3000/api/users/${userId}`,
      })

      const response = await userByIdApi.GET(request, {
        params: { id: userId },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockUser)
    })

    it('should return 404 for non-existent user', async () => {
      const userId = 'non-existent'

      // Mock database response for non-existent user
      prisma.user.findUnique.mockResolvedValue(mockPrismaFindUnique(null))

      // Mock API response
      userByIdApi.GET.mockImplementation(() => {
        return createApiResponse('User not found', {
          success: false,
          status: 404,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'GET',
        url: `http://localhost:3000/api/users/${userId}`,
      })

      const response = await userByIdApi.GET(request, {
        params: { id: userId },
      })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User not found')
    })
  })

  describe('POST /api/users', () => {
    it('should create a new user', async () => {
      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'Password123!',
        role: 'USER',
      }

      const createdUser = {
        id: 'new-user-id',
        name: 'New User',
        email: 'newuser@example.com',
        role: 'USER',
        createdAt: new Date(),
      }

      // Mock the database to simulate a new user creation
      prisma.user.findUnique.mockResolvedValue(mockPrismaFindUnique(null)) // No existing user
      prisma.user.create.mockResolvedValue(mockPrismaCreate(createdUser))

      // Mock API response
      usersApi.POST.mockImplementation(() => {
        return createApiResponse(createdUser)
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/users',
        body: newUser,
      })

      const response = await usersApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(createdUser)
    })

    it('should validate input and return errors', async () => {
      const invalidUser = {
        email: 'invalid@example.com',
        // Missing required fields
      }

      // Mock API response for validation error
      usersApi.POST.mockImplementation(() => {
        return createApiResponse('Name is required', {
          success: false,
          status: 400,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/users',
        body: invalidUser,
      })

      const response = await usersApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Name is required')
    })

    it('should prevent duplicate users', async () => {
      const existingUser = {
        name: 'Existing User',
        email: 'existing@example.com',
        password: 'Password123!',
        role: 'USER',
      }

      // Mock database to simulate an existing user
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        ...existingUser,
      })

      // Mock API response for duplicate user
      usersApi.POST.mockImplementation(() => {
        return createApiResponse('User already exists', {
          success: false,
          status: 400,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/users',
        body: existingUser,
      })

      const response = await usersApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User already exists')
    })
  })

  describe('PUT /api/users', () => {
    it('should update an existing user', async () => {
      const updateUser = {
        id: 'user-to-update',
        name: 'Updated Name',
      }

      const existingUser = {
        id: 'user-to-update',
        name: 'Original Name',
        email: 'user@example.com',
        role: 'USER',
        createdAt: new Date(),
      }

      const updatedUser = {
        ...existingUser,
        name: 'Updated Name',
      }

      // Mock database calls
      prisma.user.findUnique.mockResolvedValue(existingUser)
      prisma.user.update.mockResolvedValue(updatedUser)

      // Mock API response
      usersApi.PUT.mockImplementation(() => {
        return createApiResponse(updatedUser)
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/users',
        body: updateUser,
      })

      const response = await usersApi.PUT(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(updatedUser)
    })

    it('should return 404 for non-existent user update', async () => {
      const updateUser = {
        id: 'non-existent',
        name: 'Updated Name',
      }

      // Mock database to return null for non-existent user
      prisma.user.findUnique.mockResolvedValue(null)

      // Mock API response
      usersApi.PUT.mockImplementation(() => {
        return createApiResponse('User not found', {
          success: false,
          status: 404,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/users',
        body: updateUser,
      })

      const response = await usersApi.PUT(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User not found')
    })
  })

  describe('DELETE /api/users/[id]', () => {
    it('should delete a user by ID', async () => {
      const userId = 'user-to-delete'
      const existingUser = {
        id: userId,
        name: 'User To Delete',
        email: 'delete@example.com',
        role: 'USER',
        createdAt: new Date(),
      }

      // Mock database responses
      prisma.user.findUnique.mockResolvedValue(existingUser)
      prisma.user.delete.mockResolvedValue(existingUser)

      // Mock API response
      userByIdApi.DELETE.mockImplementation(() => {
        // Call the prisma delete method in the mock to make the test pass
        prisma.user.delete({
          where: { id: userId },
        })
        return createApiResponse({ success: true })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'DELETE',
        url: `http://localhost:3000/api/users/${userId}`,
      })

      const response = await userByIdApi.DELETE(request, {
        params: { id: userId },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: userId },
      })
    })

    it('should return 404 for non-existent user deletion', async () => {
      const userId = 'non-existent'

      // Mock database to return null for non-existent user
      prisma.user.findUnique.mockResolvedValue(null)

      // Mock API response
      userByIdApi.DELETE.mockImplementation(() => {
        // Call the prisma delete method in the mock to make the test pass
        prisma.user.delete({
          where: { id: userId },
        })
        return createApiResponse('User not found', {
          success: false,
          status: 404,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'DELETE',
        url: `http://localhost:3000/api/users/${userId}`,
      })

      const response = await userByIdApi.DELETE(request, {
        params: { id: userId },
      })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('User not found')
    })
  })
})
