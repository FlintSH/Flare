import { createWorker } from 'tesseract.js'

import { prisma } from '@/lib/database/prisma'
import { processImageOCRTask } from '@/lib/ocr/processor'
import { getStorageProvider } from '@/lib/storage'

// Mock dependencies
jest.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      update: jest.fn(),
    },
  },
}))

jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn(),
}))

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}))

describe('OCR Processor', () => {
  const mockFileStream = {
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from('mock image data')
    },
  }

  const mockWorker = {
    recognize: jest.fn(),
    terminate: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup default mock implementations
    ;(getStorageProvider as jest.Mock).mockResolvedValue({
      getFileStream: jest.fn().mockResolvedValue(mockFileStream),
    })
    ;(createWorker as jest.Mock).mockResolvedValue(mockWorker)
    mockWorker.recognize.mockResolvedValue({
      data: {
        text: 'test text',
        confidence: 95,
      },
    })
  })

  describe('processImageOCRTask', () => {
    it('should process image and update database successfully', async () => {
      const task = {
        filePath: 'test.jpg',
        fileId: '123',
      }

      const result = await processImageOCRTask(task)

      // Verify OCR processing
      expect(mockWorker.recognize).toHaveBeenCalled()
      expect(mockWorker.terminate).toHaveBeenCalled()

      // Verify database update
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          ocrText: 'test text',
          ocrConfidence: 95,
          isOcrProcessed: true,
        },
      })

      // Verify result
      expect(result).toEqual({
        success: true,
        text: 'test text',
        confidence: 95,
      })
    })

    it('should handle storage provider errors', async () => {
      const error = new Error('Storage error')
      ;(getStorageProvider as jest.Mock).mockRejectedValue(error)

      const task = {
        filePath: 'error.jpg',
        fileId: '123',
      }

      const result = await processImageOCRTask(task)

      // Verify error handling
      expect(result).toEqual({
        success: false,
        error: 'Storage error',
      })

      // Verify database update on failure
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          isOcrProcessed: true,
          ocrText: null,
          ocrConfidence: null,
        },
      })
    })

    it('should handle OCR processing errors', async () => {
      const error = new Error('OCR error')
      mockWorker.recognize.mockRejectedValue(error)

      const task = {
        filePath: 'error.jpg',
        fileId: '123',
      }

      const result = await processImageOCRTask(task)

      // Verify error handling
      expect(result).toEqual({
        success: false,
        error: 'OCR error',
      })

      // Verify database update on failure
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          isOcrProcessed: true,
          ocrText: null,
          ocrConfidence: null,
        },
      })
    })

    it('should handle empty or whitespace-only OCR results', async () => {
      mockWorker.recognize.mockResolvedValue({
        data: {
          text: '   ',
          confidence: 10,
        },
      })

      const task = {
        filePath: 'empty.jpg',
        fileId: '123',
      }

      const result = await processImageOCRTask(task)

      // Verify database update with trimmed text
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          ocrText: '',
          ocrConfidence: 10,
          isOcrProcessed: true,
        },
      })

      // Verify result
      expect(result).toEqual({
        success: true,
        text: '',
        confidence: 10,
      })
    })
  })
})
