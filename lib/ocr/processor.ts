import { createWorker } from 'tesseract.js'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

import type { OCRTask } from './queue'

const logger = loggers.ocr

export async function processImageOCRTask({ filePath, fileId }: OCRTask) {
  try {
    const storageProvider = await getStorageProvider()
    const stream = await storageProvider.getFileStream(filePath)

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }
    const fileBuffer = Buffer.concat(chunks)

    const worker = await createWorker()
    const {
      data: { text, confidence },
    } = await worker.recognize(fileBuffer)
    await worker.terminate()

    await prisma.file.update({
      where: { id: fileId },
      data: {
        ocrText: text.trim(),
        ocrConfidence: confidence,
        isOcrProcessed: true,
      },
    })

    logger.info('OCR processing completed', {
      filePath,
      fileId,
      confidence,
      textLength: text.trim().length,
    })
    return { success: true, text: text.trim(), confidence }
  } catch (error) {
    logger.error(`OCR processing failed for file ${filePath}`, error as Error, {
      fileId,
    })

    await prisma.file.update({
      where: { id: fileId },
      data: {
        isOcrProcessed: true,
        ocrText: null,
        ocrConfidence: null,
      },
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'OCR processing failed',
    }
  }
}

export interface OCRResult {
  success: boolean
  text?: string
  confidence?: number
  error?: string
}
