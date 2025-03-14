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

// Export the queue instance
export { ocrQueue }
