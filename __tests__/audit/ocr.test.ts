import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { processImageOCRTask } from '@/lib/ocr/processor'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  getStorageProvider: vi.fn(),
  getFileStream: vi.fn(),
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  applyPendingOcrTags: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: mocks.findUnique, update: mocks.update },
    // No sealed tag: no rule waits for the browser of the owner.
    vaultTag: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: mocks.getStorageProvider,
}))
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }))
vi.mock('@/lib/tags/ocr', () => ({
  applyPendingOcrTags: mocks.applyPendingOcrTags,
}))
vi.mock('@/lib/logger', () => ({
  loggers: { ocr: { info: vi.fn(), error: vi.fn() } },
}))

const recorded: Record<string, unknown>[] = []

beforeEach(() => {
  vi.resetAllMocks()
  recorded.length = 0
  configureAuditWriter(async (event) => {
    recorded.push(event)
  })
  mocks.findUnique.mockResolvedValue({ name: 'receipt.png', userId: 'owner-1' })
  mocks.getStorageProvider.mockResolvedValue({
    getFileStream: mocks.getFileStream,
  })
  mocks.getFileStream.mockImplementation(async () =>
    Readable.from([Buffer.from('fixture image')])
  )
  mocks.createWorker.mockResolvedValue({
    recognize: mocks.recognize,
    terminate: mocks.terminate,
  })
  mocks.recognize.mockResolvedValue({
    data: { text: ' private OCR receipt contents \n', confidence: 92.5 },
  })
  mocks.update.mockResolvedValue({ id: 'file-1' })
})

describe('OCR audit lifecycle', () => {
  it('records named start/completion with aggregate confidence and text length, never recognized content', async () => {
    const result = await processImageOCRTask({
      fileId: 'file-1',
      filePath: 'private/storage/receipt.png',
    })
    expect(result).toMatchObject({
      success: true,
      confidence: 92.5,
      text: 'private OCR receipt contents',
    })
    expect(recorded).toEqual([
      expect.objectContaining({
        action: 'ocr.started',
        category: 'ocr',
        targetType: 'file',
        targetId: 'file-1',
        targetName: 'receipt.png',
        details: { ownerId: 'owner-1' },
      }),
      expect.objectContaining({
        action: 'ocr.completed',
        category: 'ocr',
        targetType: 'file',
        targetId: 'file-1',
        targetName: 'receipt.png',
        details: { confidence: 92.5, textLength: 28 },
      }),
    ])
    expect(JSON.stringify(recorded)).not.toMatch(/private OCR|private\/storage/)
    expect(mocks.terminate).toHaveBeenCalledOnce()
    expect(mocks.applyPendingOcrTags).toHaveBeenCalledWith('file-1')
  })

  it.each(['storage provider', 'storage stream', 'stream read', 'recognition'])(
    'records a named failure for %s errors without leaking raw exception messages',
    async (stage) => {
      const error = new Error('private provider credential or recognized text')
      if (stage === 'storage provider')
        mocks.getStorageProvider.mockRejectedValue(error)
      if (stage === 'storage stream')
        mocks.getFileStream.mockRejectedValue(error)
      if (stage === 'stream read')
        mocks.getFileStream.mockResolvedValue(
          Readable.from(
            (async function* () {
              yield Buffer.from('partial')
              throw error
            })()
          )
        )
      if (stage === 'recognition') mocks.recognize.mockRejectedValue(error)
      expect(
        await processImageOCRTask({
          fileId: 'file-1',
          filePath: 'private/storage/receipt.png',
        })
      ).toMatchObject({ success: false })
      expect(recorded.map((event) => event.action)).toEqual([
        'ocr.started',
        'ocr.failed',
      ])
      expect(recorded[1]).toMatchObject({
        outcome: 'failure',
        targetId: 'file-1',
        targetName: 'receipt.png',
        details: { reason: 'Image recognition or storage access failed' },
      })
      expect(JSON.stringify(recorded)).not.toMatch(
        /private provider|private\/storage|recognized text/
      )
      expect(mocks.update).toHaveBeenLastCalledWith({
        where: { id: 'file-1', encrypted: false },
        data: { isOcrProcessed: true, ocrText: null, ocrConfidence: null },
      })
      expect(mocks.applyPendingOcrTags).not.toHaveBeenCalled()
      // A worker that was started is stopped, whether or not reading worked.
      expect(mocks.terminate).toHaveBeenCalledTimes(
        stage === 'recognition' ? 1 : 0
      )
    }
  )
})
