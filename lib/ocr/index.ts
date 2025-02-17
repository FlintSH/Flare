import { processImageOCRTask } from './processor'
import type { OCRResult } from './processor'
import { ocrQueue } from './queue'

export async function processImageOCR(
  filePath: string,
  fileId: string
): Promise<OCRResult> {
  try {
    const result = await processImageOCRTask({ filePath, fileId })
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'OCR processing failed',
    }
  }
}

// Export queue status functions for monitoring
export function getOCRQueueStatus() {
  return {
    queueLength: ocrQueue.getQueueLength(),
    activeProcesses: ocrQueue.getActiveProcesses(),
  }
}
