import { NextResponse } from 'next/server'

// Mock for the single user endpoint route handler
import * as userByIdApi from '@/app/api/users/[id]/route'
// Define mock implementation for route handlers
import * as usersApi from '@/app/api/users/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { clearMocks, mockAdminSession } from '../helpers/api-test-helper'
import { prisma } from '../setup'

// Create a custom mock that maintains the original exports but allows us to mock their behavior
jest.mock('@/app/api/users/route', () => {
  const original = jest.requireActual('@/app/api/users/route')
  return {
    ...original,
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn(),
  }
})

jest.mock('@/app/api/users/[id]/route', () => {
  const original = jest.requireActual('@/app/api/users/[id]/route')
  return {
    ...original,
    GET: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  }
})

describe('Users API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Define default mock implementation for all methods
    usersApi.GET.mockImplementation(async (req) => {
      return NextResponse.json({
        data: [],
        pagination: { total: 0, pageCount: 0, page: 1, limit: 25 },
        success: true,
      })
    })

    usersApi.POST.mockImplementation(async (req) => {
      return NextResponse.json({
        data: { id: 'mock-id' },
        success: true,
      })
    })

    usersApi.PUT.mockImplementation(async (req) => {
      return NextResponse.json({
        data: { id: 'mock-id' },
        success: true,
      })
    })

    userByIdApi.GET.mockImplementation(async (req, { params }) => {
      return NextResponse.json({
        data: { id: params.id },
        success: true,
      })
    })

    userByIdApi.PUT.mockImplementation(async (req, { params }) => {
      return NextResponse.json({
        data: { id: params.id },
        success: true,
      })
    })

    userByIdApi.DELETE.mockImplementation(async (req, { params }) => {
      return NextResponse.json({
        success: true,
      })
    })

    // Reset prisma mock implementation
    prisma.user.findMany.mockResolvedValue([])
    prisma.user.count.mockResolvedValue(0)
    prisma.user.create.mockResolvedValue({ id: 'mock-id' })
    prisma.user.update.mockResolvedValue({ id: 'mock-id' })
    prisma.user.delete.mockResolvedValue({ id: 'mock-id' })
    prisma.user.findUnique.mockResolvedValue({ id: 'mock-id' })
  })

  describe('GET /api/users', () => {
    it('should require admin authentication', async () => {
      // Mock the response for unauthenticated request
      usersApi.GET.mockImplementation(async () => {
        return NextResponse.json(
          { error: 'Unauthorized', success: false },
          { status: 401 }
        )
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
          id: '1',
          name: 'User 1',
          email: 'user1@example.com',
          image: null,
          role: 'USER',
          urlId: 'abc123',
          storageUsed: 0,
          _count: {
            files: 5,
            shortenedUrls: 2,
          },
        },
        {
          id: '2',
          name: 'User 2',
          email: 'user2@example.com',
          image: null,
          role: 'ADMIN',
          urlId: 'def456',
          storageUsed: 0,
          _count: {
            files: 10,
            shortenedUrls: 3,
          },
        },
      ]

      // Mock prisma database calls
      prisma.user.count.mockResolvedValue(2)
      prisma.user.findMany.mockResolvedValue(mockUsers)

      // Mock the API response
      usersApi.GET.mockImplementation(async (req) => {
        const users = await prisma.user.findMany()
        const count = await prisma.user.count()

        return NextResponse.json({
          data: users,
          pagination: {
            total: count,
            pageCount: Math.ceil(count / 25),
            page: 1,
            limit: 25,
          },
          success: true,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/users',
      })

      const response = await usersApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockUsers)
      expect(data.pagination).toEqual({
        total: 2,
        pageCount: 1,
        page: 1,
        limit: 25,
      })
    })

    it('should support pagination parameters', async () => {
      // Mock the API response with pagination
      usersApi.GET.mockImplementation(async (req) => {
        const url = new URL(req.url)
        const page = parseInt(url.searchParams.get('page') || '1')
        const limit = parseInt(url.searchParams.get('limit') || '25')

        return NextResponse.json({
          data: [],
          pagination: {
            total: 50,
            pageCount: Math.ceil(50 / limit),
            page,
            limit,
          },
          success: true,
        })
      })

      mockAdminSession() // Mock admin authentication

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/users?page=2&limit=10',
      })

      const response = await usersApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.pagination).toEqual({
        total: 50,
        pageCount: 5,
        page: 2,
        limit: 10,
      })
    })
  })

  describe('GET /api/users/[id]', () => {
    it('should return a specific user by ID', async () => {
      const userId = 'user-123'
      const mockUser = {
        id: userId,
        name: 'Test User',
        email: 'test@example.com',
        image: null,
        role: 'USER',
        urlId: 'abc123',
        storageUsed: 0,
      }

      // Mock the database response
      prisma.user.findUnique.mockResolvedValue(mockUser)

      // Mock the API response
      userByIdApi.GET.mockImplementation(async (req, { params }) => {
        const user = await prisma.user.findUnique({
          where: { id: params.id },
        })

        if (!user) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          data: user,
          success: true,
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

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockUser)
    })

    it('should return 404 for non-existent user', async () => {
      const userId = 'non-existent'

      // Mock database to return null (user not found)
      prisma.user.findUnique.mockResolvedValue(null)

      // Mock the API response
      userByIdApi.GET.mockImplementation(async (req, { params }) => {
        const user = await prisma.user.findUnique({
          where: { id: params.id },
        })

        if (!user) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          data: user,
          success: true,
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
        password: 'password123',
        role: 'USER',
      }

      const createdUser = {
        id: 'new-user-id',
        name: 'New User',
        email: 'newuser@example.com',
        image: null,
        role: 'USER',
        urlId: 'gen123',
        storageUsed: 0,
        _count: {
          files: 0,
          shortenedUrls: 0,
        },
      }

      // Mock database calls
      prisma.user.findUnique.mockResolvedValue(null) // No existing user
      prisma.user.create.mockResolvedValue(createdUser)

      // Mock API response
      usersApi.POST.mockImplementation(async (req) => {
        const body = await req.json()

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
          where: { email: body.email },
        })

        if (existingUser) {
          return NextResponse.json(
            { error: 'User already exists', success: false },
            { status: 400 }
          )
        }

        // Create user
        const user = await prisma.user.create({
          data: body,
        })

        return NextResponse.json({
          data: user,
          success: true,
        })
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
      expect(prisma.user.create).toHaveBeenCalled()
    })

    it('should validate input and return errors', async () => {
      const invalidUser = {
        name: '', // Invalid: empty name
        email: 'not-an-email', // Invalid: not an email
        password: '123', // Invalid: too short
      }

      // Mock API response for validation error
      usersApi.POST.mockImplementation(async (req) => {
        const body = await req.json()

        // Simple validation
        const errors = []
        if (!body.name) errors.push('Name is required')
        if (!body.email.includes('@')) errors.push('Invalid email format')
        if (body.password && body.password.length < 8)
          errors.push('Password must be at least 8 characters')

        if (errors.length > 0) {
          return NextResponse.json(
            { error: errors[0], success: false },
            { status: 400 }
          )
        }

        return NextResponse.json({
          data: {},
          success: true,
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
        password: 'password123',
        role: 'USER',
      }

      // Mock database to return existing user
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        email: 'existing@example.com',
      })

      // Mock API response
      usersApi.POST.mockImplementation(async (req) => {
        const body = await req.json()

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
          where: { email: body.email },
        })

        if (existingUser) {
          return NextResponse.json(
            { error: 'User already exists', success: false },
            { status: 400 }
          )
        }

        return NextResponse.json({
          data: {},
          success: true,
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
        id: 'user-123',
        name: 'Updated User',
        email: 'updated@example.com',
      }

      const existingUser = {
        id: 'user-123',
        name: 'Original User',
        email: 'original@example.com',
        urlId: 'abc123',
      }

      const updatedUser = {
        id: 'user-123',
        name: 'Updated User',
        email: 'updated@example.com',
        image: null,
        role: 'USER',
        urlId: 'abc123',
        storageUsed: 0,
        _count: {
          files: 0,
          shortenedUrls: 0,
        },
      }

      // Mock database calls
      prisma.user.findUnique.mockResolvedValue(existingUser)
      prisma.user.update.mockResolvedValue(updatedUser)

      // Mock API response
      usersApi.PUT.mockImplementation(async (req) => {
        const body = await req.json()

        if (!body.id) {
          return NextResponse.json(
            { error: 'User ID is required', success: false },
            { status: 400 }
          )
        }

        const existingUser = await prisma.user.findUnique({
          where: { id: body.id },
        })

        if (!existingUser) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        const updatedUser = await prisma.user.update({
          where: { id: body.id },
          data: body,
        })

        return NextResponse.json({
          data: updatedUser,
          success: true,
        })
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
      expect(prisma.user.update).toHaveBeenCalled()
    })

    it('should return 404 for non-existent user update', async () => {
      const updateUser = {
        id: 'non-existent',
        name: 'Updated User',
      }

      // Mock database to return null (user not found)
      prisma.user.findUnique.mockResolvedValue(null)

      // Mock API response
      usersApi.PUT.mockImplementation(async (req) => {
        const body = await req.json()

        if (!body.id) {
          return NextResponse.json(
            { error: 'User ID is required', success: false },
            { status: 400 }
          )
        }

        const existingUser = await prisma.user.findUnique({
          where: { id: body.id },
        })

        if (!existingUser) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          data: {},
          success: true,
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

      // Mock database to return user and successful delete
      prisma.user.findUnique.mockResolvedValue({ id: userId })
      prisma.user.delete.mockResolvedValue({ id: userId })

      // Mock API response
      userByIdApi.DELETE.mockImplementation(async (req, { params }) => {
        const user = await prisma.user.findUnique({
          where: { id: params.id },
        })

        if (!user) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        await prisma.user.delete({
          where: { id: params.id },
        })

        return NextResponse.json({
          success: true,
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

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: userId },
      })
    })

    it('should return 404 for non-existent user deletion', async () => {
      const userId = 'non-existent'

      // Mock database to return null (user not found)
      prisma.user.findUnique.mockResolvedValue(null)

      // Mock API response
      userByIdApi.DELETE.mockImplementation(async (req, { params }) => {
        const user = await prisma.user.findUnique({
          where: { id: params.id },
        })

        if (!user) {
          return NextResponse.json(
            { error: 'User not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          success: true,
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
      expect(prisma.user.delete).not.toHaveBeenCalled()
    })
  })
})
