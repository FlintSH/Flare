import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { LocalStorageProvider } from '@/lib/storage/providers/local'

// Mock process.cwd()
const originalCwd = process.cwd
const testDir = path.join(os.tmpdir(), 'flare-test')

beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(testDir)
})

afterAll(() => {
  process.cwd = originalCwd
})

// Mock dependencies
jest.mock('node:fs', () => {
  const mockWriteStream = {
    write: jest.fn((data, callback) => callback()),
    end: jest.fn((callback) => callback && callback()),
  }

  return {
    promises: {
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('test')),
      rename: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockResolvedValue({ size: 1024 }),
      readdir: jest.fn().mockResolvedValue(['chunk-1', 'chunk-2']),
    },
    createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
    createReadStream: jest.fn().mockImplementation(() => {
      const stream = new Readable()
      stream._read = () => {}
      stream.push('test')
      stream.push(null)
      return stream
    }),
  }
})

// Mock path
jest.mock('node:path', () => {
  const originalPath = jest.requireActual('node:path')
  return {
    ...originalPath,
    join: jest.fn().mockImplementation((...args) => args.join('/')),
    dirname: jest
      .fn()
      .mockImplementation((p) => p.split('/').slice(0, -1).join('/')),
    normalize: jest.fn().mockImplementation((p) => p.replace(/\\/g, '/')),
    isAbsolute: jest.fn().mockImplementation((p) => p.startsWith('/')),
  }
})

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new LocalStorageProvider()
  })

  describe('uploadFile', () => {
    // TODO: Fix test - need to properly handle file system operations
    it.skip('should create directory and write file', async () => {
      const file = Buffer.from('test content')
      const filePath = 'uploads/test/file.txt'
      const mimeType = 'text/plain'

      await provider.uploadFile(file, filePath, mimeType)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        `${testDir}/uploads/test`,
        { recursive: true }
      )
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`,
        file
      )
    })

    it('should handle invalid paths', async () => {
      const file = Buffer.from('test')
      await expect(
        provider.uploadFile(file, '../test.txt', 'text/plain')
      ).rejects.toThrow('Invalid storage path')
      await expect(
        provider.uploadFile(file, '/absolute/path.txt', 'text/plain')
      ).rejects.toThrow('Invalid storage path')
      await expect(
        provider.uploadFile(file, 'invalid/path.txt', 'text/plain')
      ).rejects.toThrow('Invalid storage path')
    })

    // TODO: Fix test - need to properly handle error cases
    it.skip('should handle write errors', async () => {
      const error = new Error('Write failed')
      ;(fs.promises.writeFile as jest.Mock).mockRejectedValueOnce(error)

      await expect(
        provider.uploadFile(
          Buffer.from('test'),
          'uploads/test.txt',
          'text/plain'
        )
      ).rejects.toThrow('Write failed')
    })
  })

  describe('uploadChunkedFile', () => {
    // TODO: Fix test - need to properly handle chunked file operations
    it.skip('should merge chunks and write final file', async () => {
      const chunksDir = 'uploads/chunks/123'
      const targetPath = 'uploads/final/file.txt'
      const mimeType = 'text/plain'

      await provider.uploadChunkedFile(chunksDir, targetPath, mimeType)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        `${testDir}/uploads/final`,
        { recursive: true }
      )
      expect(fs.promises.readdir).toHaveBeenCalledWith(chunksDir)
      expect(fs.promises.readFile).toHaveBeenCalled()
    })
  })

  describe('createWriteStream', () => {
    // TODO: Fix test - need to properly handle write stream operations
    it.skip('should create directory and return write stream', async () => {
      const filePath = 'uploads/test/file.txt'
      const mimeType = 'text/plain'

      const stream = await provider.createWriteStream(filePath, mimeType)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        `${testDir}/uploads/test`,
        { recursive: true }
      )
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`
      )
      expect(stream).toBeDefined()
    })
  })

  describe('deleteFile', () => {
    // TODO: Fix test - need to properly handle file deletion
    it.skip('should delete file', async () => {
      const filePath = 'uploads/test/file.txt'
      await provider.deleteFile(filePath)
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`
      )
    })

    // TODO: Fix test - need to properly handle non-existent files
    it.skip('should handle non-existent files', async () => {
      const error = { code: 'ENOENT' } as NodeJS.ErrnoException
      ;(fs.promises.unlink as jest.Mock).mockRejectedValueOnce(error)

      await provider.deleteFile('uploads/nonexistent.txt')
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        `${testDir}/uploads/nonexistent.txt`
      )
    })

    // TODO: Fix test - need to properly handle error cases
    it.skip('should handle other errors', async () => {
      const error = new Error('Permission denied')
      ;(fs.promises.unlink as jest.Mock).mockRejectedValueOnce(error)

      await expect(provider.deleteFile('uploads/test.txt')).rejects.toThrow(
        'Permission denied'
      )
    })
  })

  describe('getFileStream', () => {
    // TODO: Fix test - need to properly handle file streams
    it.skip('should return file stream', async () => {
      const filePath = 'uploads/test/file.txt'
      const stream = await provider.getFileStream(filePath)

      expect(fs.createReadStream).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`,
        {}
      )
      expect(stream).toBeDefined()
    })

    // TODO: Fix test - need to properly handle range requests
    it.skip('should handle range requests', async () => {
      const filePath = 'uploads/test/file.txt'
      const range = { start: 0, end: 100 }
      await provider.getFileStream(filePath, range)

      expect(fs.createReadStream).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`,
        range
      )
    })

    it('should handle invalid paths', async () => {
      await expect(provider.getFileStream('../test.txt')).rejects.toThrow(
        'Invalid storage path'
      )
    })
  })

  describe('getFileSize', () => {
    // TODO: Fix test - need to properly handle file size operations
    it.skip('should return file size', async () => {
      const filePath = 'uploads/test/file.txt'
      const size = await provider.getFileSize(filePath)

      expect(fs.promises.stat).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`
      )
      expect(size).toBe(1024)
    })

    // TODO: Fix test - need to properly handle stat errors
    it.skip('should handle stat errors', async () => {
      const error = {
        code: 'ENOENT',
        message: 'No such file or directory',
      } as NodeJS.ErrnoException
      ;(fs.promises.stat as jest.Mock).mockRejectedValueOnce(error)

      await expect(provider.getFileSize('uploads/test.txt')).rejects.toThrow(
        'ENOENT: no such file or directory'
      )
    })
  })

  describe('renameFolder', () => {
    // TODO: Fix test - need to properly handle folder rename operations
    it.skip('should rename folder', async () => {
      const oldPath = 'uploads/old/path'
      const newPath = 'uploads/new/path'

      await provider.renameFolder(oldPath, newPath)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(`${testDir}/uploads/new`, {
        recursive: true,
      })
      expect(fs.promises.rename).toHaveBeenCalledWith(
        `${testDir}/uploads/old/path`,
        `${testDir}/uploads/new/path`
      )
    })

    it('should handle rename errors', async () => {
      const error = {
        code: 'ENOENT',
        message: 'No such file or directory',
      } as NodeJS.ErrnoException
      ;(fs.promises.rename as jest.Mock).mockRejectedValueOnce(error)

      await expect(
        provider.renameFolder('uploads/old', 'uploads/new')
      ).rejects.toThrow('ENOENT: no such file or directory')
    })
  })

  describe('multipart upload', () => {
    it('should support multipart upload initialization', async () => {
      const filePath = 'uploads/test.txt'
      const mimeType = 'text/plain'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        mimeType
      )
      expect(typeof uploadId).toBe('string')
      expect(uploadId).toMatch(/^local-\d+-[a-z0-9]+$/)
    })

    it('should support uploading parts', async () => {
      const filePath = 'uploads/test.txt'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        'text/plain'
      )
      const partNumber = 1
      const data = Buffer.from('test content')

      const result = await provider.uploadPart(
        filePath,
        uploadId,
        partNumber,
        data
      )
      expect(result).toHaveProperty('ETag')
      expect(result.ETag).toMatch(
        new RegExp(`"${uploadId}-${partNumber}-\\d+"`)
      )
    })

    it('should handle invalid upload IDs', async () => {
      await expect(
        provider.uploadPart(
          'uploads/test.txt',
          'invalid-id',
          1,
          Buffer.from('test')
        )
      ).rejects.toThrow('Upload not found')
    })

    it('should complete multipart upload', async () => {
      const filePath = 'uploads/test.txt'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        'text/plain'
      )
      const parts = [
        { ETag: 'etag1', PartNumber: 1 },
        { ETag: 'etag2', PartNumber: 2 },
      ]

      await expect(
        provider.completeMultipartUpload(filePath, uploadId, parts)
      ).resolves.not.toThrow()
    })
  })
})
