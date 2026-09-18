import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { processImageOCR } from '@/lib/ocr'
import { processImageOCRTask } from '@/lib/ocr/processor'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  applyAutomaticTags: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { update: mocks.update } },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileStream: async () => Readable.from([Buffer.from('image')]),
  }),
}))
vi.mock('@/lib/tags/service', () => ({
  applyAutomaticTags: mocks.applyAutomaticTags,
}))
vi.mock('@/lib/ocr/queue', () => ({ ocrQueue: {} }))
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: mocks.recognize,
    terminate: mocks.terminate,
  }),
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.recognize.mockResolvedValue({
    data: { text: ' Receipt 123 ', confidence: 95 },
  })
})

describe('tags after OCR', () => {
  it.each(['background', 'on-demand'])(
    'applies rules after persisting text for %s OCR',
    async (mode) => {
      const result =
        mode === 'background'
          ? await processImageOCRTask({ fileId: 'file', filePath: 'image.png' })
          : await processImageOCR('image.png', 'file')
      expect(result).toEqual({
        success: true,
        text: 'Receipt 123',
        confidence: 95,
      })
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: 'file' },
        data: {
          ocrText: 'Receipt 123',
          ocrConfidence: 95,
          isOcrProcessed: true,
        },
      })
      expect(mocks.applyAutomaticTags).toHaveBeenCalledWith('file', 'ocr')
      expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.applyAutomaticTags.mock.invocationCallOrder[0]
      )
    }
  )

  it('preserves OCR text and its successful response when tagging fails', async () => {
    mocks.applyAutomaticTags.mockRejectedValue(
      new Error('Temporary tag failure')
    )
    await expect(processImageOCR('image.png', 'file')).resolves.toMatchObject({
      success: true,
      text: 'Receipt 123',
    })
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })

  it('does not apply rules when text extraction fails', async () => {
    mocks.recognize.mockRejectedValue(new Error('Unreadable image'))
    await expect(processImageOCR('image.png', 'file')).resolves.toMatchObject({
      success: false,
    })
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
  })
})
