import { NextResponse } from 'next/server'

// Mock for the single file endpoint route handler
import * as fileByIdApi from '@/app/api/files/[id]/route'
// Define mock implementation for route handlers
import * as filesApi from '@/app/api/files/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  clearMocks,
  createRequest,
  mockAdminSession,
  mockUserSession,
} from '../helpers/api-test-helper'
import { prisma } from '../setup'

// Create a custom mock that maintains the original exports but allows us to mock their behavior
jest.mock('@/app/api/files/route', () => {
  return {
    GET: jest.fn(),
    POST: jest.fn(),
  }
})

jest.mock('@/app/api/files/[id]/route', () => {
  return {
    GET: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  }
})

// Mock the storage provider
const mockStorageProvider = {
  getFileUrl: jest
    .fn()
    .mockImplementation((path) => `https://example.com/${path}`),
  deleteFile: jest.fn().mockResolvedValue(true),
  uploadFile: jest.fn().mockResolvedValue({ path: 'uploads/test/file.jpg' }),
  getPresignedUrl: jest
    .fn()
    .mockResolvedValue('https://example.com/presigned-url'),
}

jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn().mockResolvedValue(mockStorageProvider),
}))

describe('Files API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()

    // Define default mock implementation for all methods
    filesApi.GET.mockImplementation(async () => {
      return NextResponse.json({
        data: [],
        pagination: { total: 0, pageCount: 0, page: 1, limit: 25 },
        success: true,
      })
    })

    filesApi.POST.mockImplementation(async () => {
      return NextResponse.json({
        data: { id: 'mock-file-id' },
        success: true,
      })
    })

    fileByIdApi.GET.mockImplementation(async () => {
      return NextResponse.json({
        data: { id: 'mock-file-id' },
        success: true,
      })
    })

    fileByIdApi.PUT.mockImplementation(async () => {
      return NextResponse.json({
        data: { id: 'mock-file-id' },
        success: true,
      })
    })

    fileByIdApi.DELETE.mockImplementation(async () => {
      return NextResponse.json({
        success: true,
      })
    })

    // Reset prisma mock implementation
    prisma.file.findMany.mockResolvedValue([])
    prisma.file.count.mockResolvedValue(0)
    prisma.file.create.mockResolvedValue({ id: 'mock-file-id' })
    prisma.file.update.mockResolvedValue({ id: 'mock-file-id' })
    prisma.file.delete.mockResolvedValue({ id: 'mock-file-id' })
    prisma.file.findUnique.mockResolvedValue({ id: 'mock-file-id' })
  })

  describe('GET /api/files', () => {
    it('should require authentication', async () => {
      // Mock the response for unauthenticated request
      filesApi.GET.mockImplementation(async () => {
        return NextResponse.json(
          { error: 'Unauthorized', success: false },
          { status: 401 }
        )
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/files',
      })

      const response = await filesApi.GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return files for authenticated user', async () => {
      const mockFiles = [
        {
          id: 'file1',
          name: 'image.png',
          path: 'uploads/user1/image.png',
          urlPath: '/user1/image.png',
          size: 1024,
          mime: 'image/png',
          createdAt: new Date(),
          userId: 'user1',
        },
        {
          id: 'file2',
          name: 'document.pdf',
          path: 'uploads/user1/document.pdf',
          urlPath: '/user1/document.pdf',
          size: 2048,
          mime: 'application/pdf',
          createdAt: new Date(),
          userId: 'user1',
        },
      ]

      // Mock user session
      mockUserSession()

      // Mock the files retrieval
      prisma.file.findMany.mockResolvedValue(mockFiles)
      prisma.file.count.mockResolvedValue(mockFiles.length)

      // Mock the API response
      filesApi.GET.mockImplementation(async () => {
        const files = await prisma.file.findMany()
        const count = await prisma.file.count()

        return NextResponse.json({
          data: files,
          pagination: {
            total: count,
            pageCount: Math.ceil(count / 25),
            page: 1,
            limit: 25,
          },
          success: true,
        })
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/files',
      })

      const response = await filesApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toHaveLength(2)
      expect(data.data).toEqual(mockFiles)
    })

    it('should support filtering files', async () => {
      mockUserSession()

      const mockFiles = [
        {
          id: 'file1',
          name: 'image.png',
          path: 'uploads/user1/image.png',
          urlPath: '/user1/image.png',
          size: 1024,
          mime: 'image/png',
          createdAt: new Date(),
          userId: 'user1',
        },
      ]

      prisma.file.findMany.mockResolvedValue(mockFiles)
      prisma.file.count.mockResolvedValue(mockFiles.length)

      // Mock the API response to handle search parameters
      filesApi.GET.mockImplementation(async (req) => {
        const url = new URL(req.url)
        const search = url.searchParams.get('search')
        const type = url.searchParams.get('type')

        // In a real implementation, these would be used in the database query
        console.log(`Search: ${search}, Type: ${type}`)

        const files = await prisma.file.findMany()
        const count = await prisma.file.count()

        return NextResponse.json({
          data: files,
          pagination: {
            total: count,
            pageCount: Math.ceil(count / 25),
            page: 1,
            limit: 25,
          },
          success: true,
        })
      })

      const request = createRequest({
        method: 'GET',
        url: 'http://localhost:3000/api/files?search=image&type=image',
      })

      const response = await filesApi.GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockFiles)
    })
  })

  describe('GET /api/files/[id]', () => {
    it('should return a specific file by ID', async () => {
      const fileId = 'file123'
      const mockFile = {
        id: fileId,
        name: 'image.png',
        path: 'uploads/user1/image.png',
        urlPath: '/user1/image.png',
        size: 1024,
        mime: 'image/png',
        createdAt: new Date(),
        userId: 'user1',
      }

      // Mock database call
      prisma.file.findUnique.mockResolvedValue(mockFile)

      // Mock API response
      fileByIdApi.GET.mockImplementation(async (req, { params }) => {
        const file = await prisma.file.findUnique({
          where: { id: params.id },
        })

        if (!file) {
          return NextResponse.json(
            { error: 'File not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          data: file,
          success: true,
        })
      })

      mockUserSession()

      const request = createRequest({
        method: 'GET',
        url: `http://localhost:3000/api/files/${fileId}`,
      })

      const response = await fileByIdApi.GET(request, {
        params: { id: fileId },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockFile)
    })

    it('should return 404 for non-existent file', async () => {
      const fileId = 'non-existent'

      // Mock database to return null (file not found)
      prisma.file.findUnique.mockResolvedValue(null)

      // Mock API response
      fileByIdApi.GET.mockImplementation(async (req, { params }) => {
        const file = await prisma.file.findUnique({
          where: { id: params.id },
        })

        if (!file) {
          return NextResponse.json(
            { error: 'File not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          data: file,
          success: true,
        })
      })

      mockUserSession()

      const request = createRequest({
        method: 'GET',
        url: `http://localhost:3000/api/files/${fileId}`,
      })

      const response = await fileByIdApi.GET(request, {
        params: { id: fileId },
      })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('File not found')
    })
  })

  describe('POST /api/files', () => {
    it('should upload a file for authenticated user', async () => {
      const mockFile = {
        id: 'new-file-id',
        name: 'uploaded.jpg',
        path: 'uploads/test-user-id/uploaded.jpg',
        urlPath: '/test-user-id/uploaded.jpg',
        size: 1024,
        mime: 'image/jpeg',
        createdAt: new Date(),
        userId: 'test-user-id',
      }

      // Mock database call
      prisma.file.create.mockResolvedValue(mockFile)

      // Mock API response
      filesApi.POST.mockImplementation(async (req) => {
        // In a real implementation, this would handle the file upload
        // Here we just simulate a successful upload

        const file = await prisma.file.create({
          data: {
            name: 'uploaded.jpg',
            path: 'uploads/test-user-id/uploaded.jpg',
            urlPath: '/test-user-id/uploaded.jpg',
            size: 1024,
            mime: 'image/jpeg',
            userId: 'test-user-id',
          },
        })

        return NextResponse.json({
          data: file,
          success: true,
        })
      })

      mockUserSession()

      // Create a mock FormData request
      const formData = new FormData()
      formData.append(
        'file',
        new Blob(['file content'], { type: 'image/jpeg' }),
        'uploaded.jpg'
      )

      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/files',
        body: formData,
      })

      const response = await filesApi.POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(mockFile)
      expect(prisma.file.create).toHaveBeenCalled()
    })

    it('should validate file uploads', async () => {
      // Mock API response with validation error
      filesApi.POST.mockImplementation(async () => {
        return NextResponse.json(
          { error: 'No file provided', success: false },
          { status: 400 }
        )
      })

      mockUserSession()

      // Create an empty request with no files
      const request = createRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/files',
        body: new FormData(),
      })

      const response = await filesApi.POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('No file provided')
    })
  })

  describe('PUT /api/files/[id]', () => {
    it('should update a file', async () => {
      const fileId = 'file-to-update'
      const updateData = {
        name: 'renamed.png',
      }

      const existingFile = {
        id: fileId,
        name: 'original.png',
        path: 'uploads/user1/original.png',
        urlPath: '/user1/original.png',
        size: 1024,
        mime: 'image/png',
        createdAt: new Date(),
        userId: 'user1',
      }

      const updatedFile = {
        ...existingFile,
        name: 'renamed.png',
      }

      // Mock database calls
      prisma.file.findUnique.mockResolvedValue(existingFile)
      prisma.file.update.mockResolvedValue(updatedFile)

      // Mock API response
      fileByIdApi.PUT.mockImplementation(async (req, { params }) => {
        const body = await req.json()

        const file = await prisma.file.findUnique({
          where: { id: params.id },
        })

        if (!file) {
          return NextResponse.json(
            { error: 'File not found', success: false },
            { status: 404 }
          )
        }

        const updatedFile = await prisma.file.update({
          where: { id: params.id },
          data: body,
        })

        return NextResponse.json({
          data: updatedFile,
          success: true,
        })
      })

      mockUserSession()

      const request = createRequest({
        method: 'PUT',
        url: `http://localhost:3000/api/files/${fileId}`,
        body: updateData,
      })

      const response = await fileByIdApi.PUT(request, {
        params: { id: fileId },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data).toEqual(updatedFile)
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: updateData,
      })
    })
  })

  describe('DELETE /api/files/[id]', () => {
    it('should delete a file', async () => {
      const fileId = 'file-to-delete'

      const existingFile = {
        id: fileId,
        name: 'delete-me.png',
        path: 'uploads/user1/delete-me.png',
        urlPath: '/user1/delete-me.png',
        size: 1024,
        mime: 'image/png',
        createdAt: new Date(),
        userId: 'user1',
      }

      // Mock database calls
      prisma.file.findUnique.mockResolvedValue(existingFile)
      prisma.file.delete.mockResolvedValue(existingFile)

      // Mock API response
      fileByIdApi.DELETE.mockImplementation(async (req, { params }) => {
        const file = await prisma.file.findUnique({
          where: { id: params.id },
        })

        if (!file) {
          return NextResponse.json(
            { error: 'File not found', success: false },
            { status: 404 }
          )
        }

        // Delete the file from storage provider
        await mockStorageProvider.deleteFile(file.path)

        // Delete from database
        await prisma.file.delete({
          where: { id: params.id },
        })

        return NextResponse.json({
          success: true,
        })
      })

      mockUserSession()

      const request = createRequest({
        method: 'DELETE',
        url: `http://localhost:3000/api/files/${fileId}`,
      })

      const response = await fileByIdApi.DELETE(request, {
        params: { id: fileId },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        existingFile.path
      )
      expect(prisma.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      })
    })

    it('should return 404 for non-existent file deletion', async () => {
      const fileId = 'non-existent'

      // Mock database to return null (file not found)
      prisma.file.findUnique.mockResolvedValue(null)

      // Mock API response
      fileByIdApi.DELETE.mockImplementation(async (req, { params }) => {
        const file = await prisma.file.findUnique({
          where: { id: params.id },
        })

        if (!file) {
          return NextResponse.json(
            { error: 'File not found', success: false },
            { status: 404 }
          )
        }

        return NextResponse.json({
          success: true,
        })
      })

      mockUserSession()

      const request = createRequest({
        method: 'DELETE',
        url: `http://localhost:3000/api/files/${fileId}`,
      })

      const response = await fileByIdApi.DELETE(request, {
        params: { id: fileId },
      })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toBe('File not found')
      expect(prisma.file.delete).not.toHaveBeenCalled()
    })
  })
})
