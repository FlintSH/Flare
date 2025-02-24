import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'

import { S3StorageProvider } from '@/lib/storage/providers/s3'

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn()
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    UploadPartCommand: jest.fn().mockImplementation((input) => ({ input })),
    HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    CreateMultipartUploadCommand: jest
      .fn()
      .mockImplementation((input) => ({ input })),
    CompleteMultipartUploadCommand: jest
      .fn()
      .mockImplementation((input) => ({ input })),
  }
})

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue('https://test-bucket.s3.amazonaws.com/test/file.txt'),
}))

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider
  const s3Config = {
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new S3StorageProvider(s3Config)
  })

  describe('uploadFile', () => {
    it('should upload file to S3', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({})

      const file = Buffer.from('test content')
      const filePath = 'test/file.txt'
      const mimeType = 'text/plain'

      await provider.uploadFile(file, filePath, mimeType)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            Body: file,
            ContentType: mimeType,
          },
        })
      )
    })

    it('should handle upload errors', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      const error = new Error('Upload failed')
      mockSend.mockRejectedValue(error)

      await expect(
        provider.uploadFile(Buffer.from('test'), 'test.txt', 'text/plain')
      ).rejects.toThrow('Upload failed')
    })
  })

  describe('deleteFile', () => {
    it('should delete file from S3', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({})

      const filePath = 'test/file.txt'
      await provider.deleteFile(filePath)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
          },
        })
      )
    })

    it('should handle non-existent files', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      const error = { name: 'NoSuchKey' }
      mockSend.mockRejectedValueOnce(error)

      // NoSuchKey errors should be ignored
      await provider.deleteFile('nonexistent.txt')
      expect(mockSend).toHaveBeenCalled()
    })
  })

  describe('getFileStream', () => {
    it('should get file stream from S3', async () => {
      const mockStream = new Readable()
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({ Body: mockStream })

      const filePath = 'test/file.txt'
      const stream = await provider.getFileStream(filePath)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
          },
        })
      )
      expect(stream).toBe(mockStream)
    })

    it('should handle range requests', async () => {
      const mockStream = new Readable()
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({ Body: mockStream })

      const filePath = 'test/file.txt'
      const range = { start: 0, end: 100 }
      await provider.getFileStream(filePath, range)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            Range: `bytes=${range.start}-${range.end}`,
          },
        })
      )
    })
  })

  describe('getFileUrl', () => {
    it('should generate presigned URL', async () => {
      const filePath = 'test/file.txt'
      const url = await provider.getFileUrl(filePath)

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
          },
        }),
        { expiresIn: expect.any(Number) }
      )
      expect(url).toBe('https://test-bucket.s3.amazonaws.com/test/file.txt')
    })
  })

  describe('getFileSize', () => {
    it('should return file size from S3', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({ ContentLength: 1024 })

      const filePath = 'test/file.txt'
      const size = await provider.getFileSize(filePath)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
          },
        })
      )
      expect(size).toBe(1024)
    })
  })

  describe('multipart upload', () => {
    it('should initialize multipart upload', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      const uploadId = 'test-upload-id'
      mockSend.mockResolvedValue({ UploadId: uploadId })

      const filePath = 'test/file.txt'
      const mimeType = 'text/plain'
      const result = await provider.initializeMultipartUpload(
        filePath,
        mimeType
      )

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            ContentType: mimeType,
          },
        })
      )
      expect(result).toBe(uploadId)
    })

    it('should get presigned URL for part upload', async () => {
      const filePath = 'test/file.txt'
      const uploadId = 'test-upload-id'
      const partNumber = 1
      const url = await provider.getPresignedPartUploadUrl(
        filePath,
        uploadId,
        partNumber
      )

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            UploadId: uploadId,
            PartNumber: partNumber,
          },
        }),
        { expiresIn: expect.any(Number) }
      )
      expect(url).toBe('https://test-bucket.s3.amazonaws.com/test/file.txt')
    })

    it('should upload part', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      const eTag = 'test-etag'
      mockSend.mockResolvedValue({ ETag: eTag })

      const filePath = 'test/file.txt'
      const uploadId = 'test-upload-id'
      const partNumber = 1
      const data = Buffer.from('test content')
      const result = await provider.uploadPart(
        filePath,
        uploadId,
        partNumber,
        data
      )

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: data,
          },
        })
      )
      expect(result).toEqual({ ETag: eTag })
    })

    it('should complete multipart upload', async () => {
      const mockSend = (S3Client as jest.Mock).mock.results[0].value.send
      mockSend.mockResolvedValue({})

      const filePath = 'test/file.txt'
      const uploadId = 'test-upload-id'
      const parts = [
        { ETag: 'etag1', PartNumber: 1 },
        { ETag: 'etag2', PartNumber: 2 },
      ]

      await provider.completeMultipartUpload(filePath, uploadId, parts)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: s3Config.bucket,
            Key: filePath,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          },
        })
      )
    })
  })
})
