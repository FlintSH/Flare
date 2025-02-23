import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import { processImageOCRTask } from './processor'

interface OCRTask {
  filePath: string
  fileId: string
}

class OCRQueue {
  private queue: OCRTask[] = []
  private processing: boolean = false
  private concurrentLimit: number = 1
  private activeProcesses: number = 0

  async add(task: OCRTask, force: boolean = false) {
    // Check if OCR is enabled in settings, unless force is true
    if (!force) {
      const config = await getConfig()
      if (!config.settings.general.ocr.enabled) {
        console.log('OCR processing is disabled in settings, skipping queue')
        await prisma.file.update({
          where: { id: task.fileId },
          data: {
            isOcrProcessed: true,
            ocrText: null,
            ocrConfidence: null,
          },
        })
        return
      }
    }

    this.queue.push(task)
    this.processQueue()
  }

  private async processQueue() {
    if (this.processing || this.activeProcesses >= this.concurrentLimit) return

    this.processing = true

    while (
      this.queue.length > 0 &&
      this.activeProcesses < this.concurrentLimit
    ) {
      const task = this.queue.shift()
      if (!task) continue

      this.activeProcesses++

      try {
        await processImageOCRTask(task)
      } catch (error) {
        console.error(`OCR processing failed for file ${task.filePath}:`, error)
      } finally {
        this.activeProcesses--
      }
    }

    this.processing = false

    // If there are still items in the queue and we're under the limit, continue processing
    if (this.queue.length > 0 && this.activeProcesses < this.concurrentLimit) {
      this.processQueue()
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getActiveProcesses(): number {
    return this.activeProcesses
  }
}

// Create a singleton instance of the queue
export const ocrQueue = new OCRQueue()

// Export the OCRTask type for use in other files
export type { OCRTask }
