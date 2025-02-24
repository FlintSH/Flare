import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { processImageOCRTask } from '@/lib/ocr/processor'
import { ocrQueue } from '@/lib/ocr/queue'

// Mock dependencies
jest.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      update: jest.fn(),
    },
  },
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}))

jest.mock('@/lib/ocr/processor', () => ({
  processImageOCRTask: jest.fn(),
}))

describe('OCRQueue', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks()

    // Reset mock implementations
    ;(getConfig as jest.Mock).mockResolvedValue({
      settings: {
        general: {
          ocr: {
            enabled: true,
          },
        },
      },
    })
    ;(processImageOCRTask as jest.Mock).mockResolvedValue({
      success: true,
      text: 'test text',
      confidence: 95,
    })

    // Reset queue state
    while (ocrQueue.getQueueLength() > 0) {
      ocrQueue['queue'].shift()
    }
    ocrQueue['activeProcesses'] = 0
    ocrQueue['processing'] = false
  })

  describe('add', () => {
    it('should add task to queue when OCR is enabled', async () => {
      const task = { filePath: 'test.jpg', fileId: '123' }
      await ocrQueue.add(task)

      expect(processImageOCRTask).toHaveBeenCalledWith(task)
    })

    it('should skip processing when OCR is disabled', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            ocr: {
              enabled: false,
            },
          },
        },
      })

      const task = { filePath: 'test.jpg', fileId: '123' }
      await ocrQueue.add(task)

      expect(processImageOCRTask).not.toHaveBeenCalled()
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          isOcrProcessed: true,
          ocrText: null,
          ocrConfidence: null,
        },
      })
    })

    it('should process task when force is true, regardless of settings', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            ocr: {
              enabled: false,
            },
          },
        },
      })

      const task = { filePath: 'test.jpg', fileId: '123' }
      await ocrQueue.add(task, true)

      expect(processImageOCRTask).toHaveBeenCalledWith(task)
    })
  })

  describe('queue management', () => {
    it('should process multiple tasks sequentially', async () => {
      const tasks = [
        { filePath: 'test1.jpg', fileId: '1' },
        { filePath: 'test2.jpg', fileId: '2' },
        { filePath: 'test3.jpg', fileId: '3' },
      ]

      // Add all tasks
      await Promise.all(tasks.map((task) => ocrQueue.add(task)))

      // Verify all tasks were processed
      expect(processImageOCRTask).toHaveBeenCalledTimes(3)
      tasks.forEach((task) => {
        expect(processImageOCRTask).toHaveBeenCalledWith(task)
      })
    })

    it('should handle processing errors gracefully', async () => {
      ;(processImageOCRTask as jest.Mock).mockRejectedValueOnce(
        new Error('Processing failed')
      )

      const task = { filePath: 'error.jpg', fileId: '123' }
      await ocrQueue.add(task)

      // Should not throw and should continue processing
      expect(processImageOCRTask).toHaveBeenCalledWith(task)
    })
  })

  describe('queue status', () => {
    it('should report correct queue length', async () => {
      expect(ocrQueue.getQueueLength()).toBe(0)

      // Create a promise that we'll resolve when we want the processing to start
      let startProcessing: () => void
      const processingPromise = new Promise<void>((resolve) => {
        startProcessing = resolve
      })

      // Mock the processor to wait for our signal
      ;(processImageOCRTask as jest.Mock).mockImplementation(async () => {
        await processingPromise
        return { success: true }
      })

      // Add multiple tasks to ensure we can see them in the queue
      const tasks = [
        { filePath: 'test1.jpg', fileId: '1' },
        { filePath: 'test2.jpg', fileId: '2' },
        { filePath: 'test3.jpg', fileId: '3' },
      ]

      // Add tasks without awaiting completion
      const addPromises = tasks.map((task) => ocrQueue.add(task))

      // Wait a bit for tasks to be added to queue
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify queue length before processing starts
      expect(ocrQueue.getQueueLength()).toBeGreaterThan(0)

      // Allow processing to complete
      startProcessing!()
      await Promise.all(addPromises)
    })

    it('should report correct number of active processes', async () => {
      // Reset active processes
      ocrQueue['activeProcesses'] = 0
      expect(ocrQueue.getActiveProcesses()).toBe(0)

      // Create a promise that we'll resolve when we want the processing to complete
      let finishProcessing: () => void
      const processingPromise = new Promise<void>((resolve) => {
        finishProcessing = resolve
      })

      // Mock a slow processing task
      ;(processImageOCRTask as jest.Mock).mockImplementation(async () => {
        await processingPromise
        return { success: true }
      })

      // Add task without awaiting completion
      const task = { filePath: 'test.jpg', fileId: '123' }
      const addPromise = ocrQueue.add(task)

      // Wait a bit for processing to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Check active processes during processing
      expect(ocrQueue.getActiveProcesses()).toBe(1)

      // Allow processing to complete
      finishProcessing!()
      await addPromise
    })
  })
})
