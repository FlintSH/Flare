import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'stream'

import { LocalStorageProvider } from '@/lib/storage/providers/local'

// Setup for tests
describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider
  let originalCwd: typeof process.cwd
  const testDir = '/test-dir'

  // Mock fs module
  beforeAll(() => {
    // Save original cwd
    originalCwd = process.cwd

    // Mock file system functions
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    jest.spyOn(fs.promises, 'readFile').mockImplementation((filepath) => {
      const pathStr = filepath.toString()
      if (pathStr.includes('chunk-1')) {
        return Promise.resolve(Buffer.from('chunk 1 content'))
      }
      if (pathStr.includes('chunk-2')) {
        return Promise.resolve(Buffer.from('chunk 2 content'))
      }
      return Promise.resolve(Buffer.from('test content'))
    })
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined)
    jest.spyOn(fs.promises, 'rename').mockResolvedValue(undefined)
    jest
      .spyOn(fs.promises, 'stat')
      .mockResolvedValue({ size: 1024 } as fs.Stats)

    // Custom dirent objects that simulate both name properties and string methods
    // This is needed since the code treats the results of fs.readdir as both Dirents and strings
    const createDirent = (name: string): fs.Dirent => {
      const dirent = {
        name,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
        toString: () => name,
        startsWith: (prefix: string) => name.startsWith(prefix),
        split: (delimiter: string) => name.split(delimiter),
      } as unknown as fs.Dirent

      return dirent
    }

    // Create mock directory entries
    const mockDirents = [createDirent('chunk-1'), createDirent('chunk-2')]

    jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents)

    // Mock path.join function
    jest.spyOn(path, 'join').mockImplementation((...args) => {
      return args.join('/').replace(/\/+/g, '/')
    })

    // Mock the read/write streams
    const mockWriteStream = {
      write: jest.fn((data, callback) => {
        if (callback) callback()
        return true
      }),
      end: jest.fn(function (callback) {
        if (callback) callback()
        this.emit('finish')
        return this
      }),
      emit: jest.fn(),
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 0)
        }
        return this
      }),
    }

    jest
      .spyOn(fs, 'createWriteStream')
      .mockReturnValue(mockWriteStream as unknown as fs.WriteStream)

    // Create a readable stream that can be cast to ReadStream
    const mockReadStream = new Readable({
      read() {
        this.push('test content')
        this.push(null)
      },
    })

    // Add properties expected on ReadStream
    Object.defineProperties(mockReadStream, {
      path: { value: 'test/path' },
      bytesRead: { value: 0 },
      close: { value: jest.fn() },
      pending: { value: false },
    })

    jest
      .spyOn(fs, 'createReadStream')
      .mockReturnValue(mockReadStream as unknown as fs.ReadStream)
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)

    // Mock path functions - important for storage path validation
    jest.spyOn(path, 'normalize').mockImplementation((p) => p)
    jest.spyOn(path, 'isAbsolute').mockImplementation((p) => p.startsWith('/'))

    // Save original env
    process.env.NEXTAUTH_URL =
      process.env.NEXTAUTH_URL || 'http://localhost:3000'
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Mock process.cwd to return a fixed directory
    process.cwd = jest.fn().mockReturnValue(testDir)
    provider = new LocalStorageProvider()
  })

  afterAll(() => {
    // Restore original functions
    jest.restoreAllMocks()
    process.cwd = originalCwd
  })

  describe('uploadFile', () => {
    it('should create directory and write file', async () => {
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
        provider.uploadFile(file, './invalid/path.txt', 'text/plain')
      ).rejects.toThrow('Invalid storage path')
    })

    it('should handle write errors', async () => {
      const file = Buffer.from('test content')
      const filePath = 'uploads/test/file.txt'

      // Mock a write error
      jest
        .spyOn(fs.promises, 'writeFile')
        .mockRejectedValueOnce(new Error('Write failed'))

      await expect(
        provider.uploadFile(file, filePath, 'text/plain')
      ).rejects.toThrow('Write failed')
    })
  })

  describe('uploadChunkedFile', () => {
    it('should merge chunks and write final file', async () => {
      const chunksDir = `${testDir}/uploads/chunks/123`
      const targetPath = 'uploads/final/file.txt'
      const mimeType = 'text/plain'

      // Create dummy write stream state to prevent "undefined" error in the implementation
      const mockStream = fs.createWriteStream(
        `${testDir}/uploads/final/file.txt`
      )
      provider['activeWriteStreams'] = new Map()
      provider['activeWriteStreams'].set(`${testDir}/uploads/final/file.txt`, {
        stream: mockStream,
        processedChunks: new Set(),
      })

      await provider.uploadChunkedFile(chunksDir, targetPath, mimeType)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        `${testDir}/uploads/final`,
        { recursive: true }
      )
      expect(fs.promises.readdir).toHaveBeenCalledWith(chunksDir)
      expect(fs.promises.readFile).toHaveBeenCalledTimes(2) // Two chunks
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${testDir}/uploads/final/file.txt`
      )
    })

    it('should create a write stream if none exists', async () => {
      const chunksDir = `${testDir}/uploads/chunks/123`
      const targetPath = 'uploads/final/new-file.txt'
      const mimeType = 'text/plain'

      // Ensure no write stream exists for this file
      provider['activeWriteStreams'] = new Map()

      await provider.uploadChunkedFile(chunksDir, targetPath, mimeType)

      // The method should create a write stream
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${testDir}/uploads/final/new-file.txt`
      )
    })
  })

  describe('createWriteStream', () => {
    it('should create directory and return write stream', async () => {
      const filePath = 'uploads/test/stream.txt'
      const mimeType = 'text/plain'

      const stream = await provider.createWriteStream(filePath, mimeType)

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        `${testDir}/uploads/test`,
        { recursive: true }
      )
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${testDir}/uploads/test/stream.txt`
      )
      expect(stream).toBeDefined()
    })
  })

  describe('deleteFile', () => {
    it('should delete file', async () => {
      const filePath = 'uploads/test/file.txt'

      await provider.deleteFile(filePath)

      expect(fs.promises.unlink).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`
      )
    })

    it('should handle non-existent files', async () => {
      const nonExistentPath = 'uploads/nonexistent.txt'

      // Mock an ENOENT error
      jest.spyOn(fs.promises, 'unlink').mockRejectedValueOnce({
        code: 'ENOENT',
        message: 'No such file',
      })

      // Should not throw an error
      await expect(provider.deleteFile(nonExistentPath)).resolves.not.toThrow()
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        `${testDir}/uploads/nonexistent.txt`
      )
    })

    it('should handle other errors', async () => {
      // Mock a permission error
      jest
        .spyOn(fs.promises, 'unlink')
        .mockRejectedValueOnce(new Error('Permission denied'))

      await expect(provider.deleteFile('uploads/test.txt')).rejects.toThrow(
        'Permission denied'
      )
    })
  })

  describe('getFileStream', () => {
    it('should return file stream', async () => {
      const filePath = 'uploads/test/file.txt'

      const stream = await provider.getFileStream(filePath)

      expect(fs.createReadStream).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`,
        {}
      )
      expect(stream).toBeDefined()
    })

    it('should handle range requests', async () => {
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

  describe('getFileUrl', () => {
    it('should return raw URL for non-video files', async () => {
      const filePath = 'uploads/test/image.jpg'

      const url = await provider.getFileUrl(filePath)

      expect(url).toBe('http://localhost:3000/test/image.jpg/raw')
    })

    it('should return API URL for video files', async () => {
      const filePath = 'uploads/test/video.mp4'

      const url = await provider.getFileUrl(filePath)

      expect(url).toBe('http://localhost:3000/api/files/test/video.mp4')
    })

    it('should handle paths with leading slashes', async () => {
      const filePath = '/uploads/test/file.txt'

      const url = await provider.getFileUrl(filePath)

      expect(url).toBe('http://localhost:3000/test/file.txt/raw')
    })

    it('should use custom NEXTAUTH_URL if available', async () => {
      // Temporarily modify the env variable
      const originalUrl = process.env.NEXTAUTH_URL
      process.env.NEXTAUTH_URL = 'https://example.com'

      const filePath = 'uploads/test/file.txt'
      const url = await provider.getFileUrl(filePath)

      expect(url).toBe('https://example.com/test/file.txt/raw')

      // Restore the original env variable
      process.env.NEXTAUTH_URL = originalUrl
    })
  })

  describe('getFileSize', () => {
    it('should return file size', async () => {
      const filePath = 'uploads/test/file.txt'

      const size = await provider.getFileSize(filePath)

      expect(fs.promises.stat).toHaveBeenCalledWith(
        `${testDir}/uploads/test/file.txt`
      )
      expect(size).toBe(1024)
    })

    it('should handle stat errors', async () => {
      // Mock an ENOENT error - this error needs to be properly thrown
      jest
        .spyOn(fs.promises, 'stat')
        .mockRejectedValueOnce(new Error('ENOENT: No such file or directory'))

      await expect(
        provider.getFileSize('uploads/nonexistent.txt')
      ).rejects.toThrow('ENOENT')
    })
  })

  describe('renameFolder', () => {
    it('should rename folder', async () => {
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
      // Mock an error
      jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValueOnce(new Error('Rename failed'))

      await expect(
        provider.renameFolder('uploads/old', 'uploads/new')
      ).rejects.toThrow('Rename failed')
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

      expect(fs.promises.mkdir).toHaveBeenCalled()
      expect(fs.createWriteStream).toHaveBeenCalled()
      expect(typeof uploadId).toBe('string')
      expect(uploadId).toMatch(/^local-\d+-[a-z0-9]+$/)
    })

    it('should support uploading parts', async () => {
      const filePath = 'uploads/test.txt'
      const mimeType = 'text/plain'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        mimeType
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

    it('should throw error for invalid upload ID when completing multipart upload', async () => {
      const invalidUploadId = 'non-existent-id'

      await expect(
        provider.completeMultipartUpload('uploads/test.txt', invalidUploadId, [
          { ETag: 'tag1', PartNumber: 1 },
        ])
      ).rejects.toThrow('Upload not found')
    })

    it('should complete multipart upload', async () => {
      const filePath = 'uploads/test.txt'
      const mimeType = 'text/plain'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        mimeType
      )

      // Upload parts
      await provider.uploadPart(filePath, uploadId, 1, Buffer.from('part 1'))
      await provider.uploadPart(filePath, uploadId, 2, Buffer.from('part 2'))

      const parts = [
        { ETag: 'etag1', PartNumber: 1 },
        { ETag: 'etag2', PartNumber: 2 },
      ]

      await provider.completeMultipartUpload(filePath, uploadId, parts)

      // The 'end' method should have been called on the write stream
      const writeStream = (fs.createWriteStream as jest.Mock).mock.results[0]
        .value
      expect(writeStream.end).toHaveBeenCalled()
    })

    it('should handle remaining parts during multipart upload completion', async () => {
      const filePath = 'uploads/test.txt'
      const mimeType = 'text/plain'
      const uploadId = await provider.initializeMultipartUpload(
        filePath,
        mimeType
      )

      // Create an upload with remaining parts
      const uploadState = provider['multipartUploads'].get(uploadId)
      if (uploadState) {
        // Add some unprocessed parts
        uploadState.parts.set(1, Buffer.from('part 1 data'))
        uploadState.parts.set(2, Buffer.from('part 2 data'))
      }

      const parts = [
        { ETag: 'etag1', PartNumber: 1 },
        { ETag: 'etag2', PartNumber: 2 },
      ]

      await provider.completeMultipartUpload(filePath, uploadId, parts)

      // Verify all parts were written
      const writeStream = (fs.createWriteStream as jest.Mock).mock.results[0]
        .value
      expect(writeStream.write).toHaveBeenCalledTimes(2)
      expect(writeStream.end).toHaveBeenCalled()
    })

    it('should get presigned part upload URL', async () => {
      const uploadId = 'test-upload-id'
      const partNumber = 1

      const url = await provider.getPresignedPartUploadUrl(
        'uploads/test.txt',
        uploadId,
        partNumber
      )

      expect(url).toBe(`local://${uploadId}/${partNumber}`)
    })
  })
})
