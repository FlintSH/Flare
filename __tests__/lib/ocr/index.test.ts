import { getOCRQueueStatus, ocrQueue, processImageOCR } from '@/lib/ocr'
import { processImageOCRTask } from '@/lib/ocr/processor'

// Mock dependencies
jest.mock('@/lib/ocr/processor', () => ({
  processImageOCRTask: jest.fn(),
}))

describe('OCR Interface', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Setup default mock implementation
    ;(processImageOCRTask as jest.Mock).mockResolvedValue({
      success: true,
      text: 'test text',
      confidence: 95,
    })
  })

  describe('processImageOCR', () => {
    it('should process image successfully', async () => {
      const result = await processImageOCR('test.jpg', '123')

      expect(result).toEqual({
        success: true,
        text: 'test text',
        confidence: 95,
      })
    })

    it('should handle processing errors', async () => {
      const error = new Error('Processing failed')
      ;(processImageOCRTask as jest.Mock).mockRejectedValue(error)

      const result = await processImageOCR('error.jpg', '123')

      expect(result).toEqual({
        success: false,
        error: 'Processing failed',
      })
    })

    it('should handle non-Error objects in catch block', async () => {
      ;(processImageOCRTask as jest.Mock).mockRejectedValue('Unknown error')

      const result = await processImageOCR('error.jpg', '123')

      expect(result).toEqual({
        success: false,
        error: 'OCR processing failed',
      })
    })
  })

  describe('getOCRQueueStatus', () => {
    it('should return current queue status', () => {
      // Mock queue length and active processes
      jest.spyOn(ocrQueue, 'getQueueLength').mockReturnValue(5)
      jest.spyOn(ocrQueue, 'getActiveProcesses').mockReturnValue(2)

      const status = getOCRQueueStatus()

      expect(status).toEqual({
        queueLength: 5,
        activeProcesses: 2,
      })
    })

    it('should handle empty queue', () => {
      // Mock empty queue
      jest.spyOn(ocrQueue, 'getQueueLength').mockReturnValue(0)
      jest.spyOn(ocrQueue, 'getActiveProcesses').mockReturnValue(0)

      const status = getOCRQueueStatus()

      expect(status).toEqual({
        queueLength: 0,
        activeProcesses: 0,
      })
    })
  })
})
