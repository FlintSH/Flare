import { join } from 'path'

import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'

// Mock prisma
jest.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findFirst: jest.fn(),
    },
  },
}))

describe('Filename Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.file.findFirst as jest.Mock).mockResolvedValue(null)
  })

  describe('getUniqueFilename', () => {
    it('should convert filename to URL-safe format', async () => {
      const result = await getUniqueFilename('uploads', 'Test File.PDF')
      expect(result).toEqual({
        urlSafeName: 'test-file.pdf',
        displayName: 'Test File.PDF',
      })
    })

    it('should handle filenames without extensions', async () => {
      const result = await getUniqueFilename('uploads', 'Test Document')
      expect(result).toEqual({
        urlSafeName: 'test-document',
        displayName: 'Test Document',
      })
    })

    it('should handle special characters and spaces', async () => {
      const result = await getUniqueFilename('uploads', 'Test@#$% File!.jpg')
      expect(result).toEqual({
        urlSafeName: 'test-file.jpg',
        displayName: 'Test@#$% File!.jpg',
      })
    })

    it('should handle leading/trailing special characters', async () => {
      const result = await getUniqueFilename('uploads', '---Test File---.pdf')
      expect(result).toEqual({
        urlSafeName: 'test-file.pdf',
        displayName: '---Test File---.pdf',
      })
    })

    it('should append counter for duplicate filenames', async () => {
      // Mock first file exists, second doesn't
      ;(prisma.file.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: '1' })
        .mockResolvedValueOnce(null)

      const result = await getUniqueFilename('uploads', 'test.pdf')
      expect(result).toEqual({
        urlSafeName: 'test-1.pdf',
        displayName: 'test.pdf',
      })
    })

    it('should handle multiple duplicates', async () => {
      // Mock first two files exist, third doesn't
      ;(prisma.file.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: '1' })
        .mockResolvedValueOnce({ id: '2' })
        .mockResolvedValueOnce(null)

      const result = await getUniqueFilename('uploads', 'test.pdf')
      expect(result).toEqual({
        urlSafeName: 'test-2.pdf',
        displayName: 'test.pdf',
      })
    })

    it('should throw error for empty inputs', async () => {
      await expect(getUniqueFilename('', 'test.pdf')).rejects.toThrow(
        'Base path and original name are required'
      )
      await expect(getUniqueFilename('uploads', '')).rejects.toThrow(
        'Base path and original name are required'
      )
    })

    it('should handle directory traversal attempts', async () => {
      // The function strips out special characters, so '../' becomes just 'test.pdf'
      const result = await getUniqueFilename('uploads', '../test.pdf')
      expect(result).toEqual({
        urlSafeName: 'test.pdf',
        displayName: '../test.pdf',
      })

      const result2 = await getUniqueFilename('uploads', '..\\test.pdf')
      expect(result2).toEqual({
        urlSafeName: 'test.pdf',
        displayName: '..\\test.pdf',
      })

      // Verify that the paths are properly normalized in the database check
      expect(prisma.file.findFirst).toHaveBeenCalledWith({
        where: {
          path: join('uploads', 'test.pdf'),
        },
      })
    })

    it('should normalize paths with multiple slashes', async () => {
      const result = await getUniqueFilename('uploads///temp//', 'test.pdf')
      expect(result.urlSafeName).toBe('test.pdf')
      expect(prisma.file.findFirst).toHaveBeenCalledWith({
        where: {
          path: join('uploads/temp', 'test.pdf'),
        },
      })
    })

    it('should handle complex nested paths', async () => {
      const result = await getUniqueFilename(
        'uploads/user-123/documents',
        'My Report.pdf'
      )
      expect(result.urlSafeName).toBe('my-report.pdf')
      expect(prisma.file.findFirst).toHaveBeenCalledWith({
        where: {
          path: join('uploads/user-123/documents', 'my-report.pdf'),
        },
      })
    })

    it('should handle case sensitivity in extensions', async () => {
      const result = await getUniqueFilename('uploads', 'test.PDF')
      expect(result).toEqual({
        urlSafeName: 'test.pdf',
        displayName: 'test.PDF',
      })
    })

    it('should handle multiple dots in filename', async () => {
      const result = await getUniqueFilename('uploads', 'my.test.file.PDF')
      expect(result).toEqual({
        urlSafeName: 'my-test-file.pdf',
        displayName: 'my.test.file.PDF',
      })
    })
  })
})
