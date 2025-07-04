import { createWorker } from 'tesseract.js'

import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

import type { OCRTask } from './queue'

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

    console.log(`OCR completed for file ${filePath}`)
    return { success: true, text: text.trim(), confidence }
  } catch (error) {
    console.error(`OCR processing failed for file ${filePath}:`, error)

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
