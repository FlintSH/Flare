import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The OCR queue remembers in-flight work and recent failures per process, so
// each test loads a fresh copy of the route and queue.
let GET: typeof import('@/app/api/files/[id]/ocr/route').GET
let ocrQueue: typeof import('@/lib/ocr').ocrQueue
let processImageOCRTask: typeof import('@/lib/ocr/processor').processImageOCRTask

async function processImageOCR(filePath: string, fileId: string) {
  const outcome = await ocrQueue.request({ filePath, fileId })
  if (outcome.status !== 'done') throw new Error(outcome.status)
  return outcome.result
}

const mocks = vi.hoisted(() => ({
  file: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  applyAutomaticTags: vi.fn(),
  checkFileAccess: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: mocks.file,
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({ user: { id: 'owner' } }),
}))
vi.mock('@/lib/files/access', () => ({
  checkFileAccess: mocks.checkFileAccess,
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileStream: async () => Readable.from([Buffer.from('image')]),
  }),
}))
vi.mock('@/lib/tags/service', () => ({
  applyAutomaticTags: mocks.applyAutomaticTags,
}))
vi.mock('@/lib/logger', () => ({
  loggers: {
    ocr: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    files: { error: vi.fn() },
  },
}))
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: mocks.recognize,
    terminate: mocks.terminate,
  }),
}))

const now = new Date('2026-09-18T12:00:00.000Z')
const transaction = {
  file: mocks.file,
  $queryRaw: mocks.queryRaw,
}
function newFile() {
  return {
    id: 'file',
    userId: 'owner',
    mimeType: 'image/png',
    isOcrProcessed: false,
    ocrText: null as string | null,
    ocrConfidence: null as number | null,
    ocrTagsPendingAt: null as Date | null,
    path: 'image.png',
    visibility: 'PRIVATE',
    password: null,
  }
}
let file = newFile()

beforeEach(async () => {
  vi.resetModules()
  ;({ GET } = await import('@/app/api/files/[id]/ocr/route'))
  ;({ ocrQueue } = await import('@/lib/ocr'))
  ;({ processImageOCRTask } = await import('@/lib/ocr/processor'))
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  file = newFile()
  mocks.recognize.mockResolvedValue({
    data: { text: ' Receipt 123 ', confidence: 95 },
  })
  mocks.checkFileAccess.mockResolvedValue({ allowed: true })
  mocks.applyAutomaticTags.mockResolvedValue(1)
  mocks.file.findUnique.mockImplementation(async () => ({ ...file }))
  mocks.file.update.mockImplementation(async ({ data }) => {
    Object.assign(file, data)
    return { ...file }
  })
  mocks.file.updateMany.mockImplementation(async ({ where, data }) => {
    if (
      where.ocrTagsPendingAt?.getTime() !== file.ocrTagsPendingAt?.getTime()
    ) {
      return { count: 0 }
    }
    Object.assign(file, data)
    return { count: 1 }
  })
  mocks.queryRaw.mockImplementation(async () => [{ ...file }])
  mocks.transaction.mockImplementation(async (callback) => {
    const original = { ...file }
    try {
      return await callback(transaction)
    } catch (error) {
      file = original
      throw error
    }
  })
})
afterEach(() => vi.useRealTimers())

async function getOcr() {
  return GET(new Request('https://flare.test/api/files/file/ocr'), {
    params: Promise.resolve({ id: 'file' }),
  })
}

describe('tags after OCR', () => {
  it.each(['background', 'on-demand'])(
    'persists text and retry work together before tagging %s OCR',
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
      expect(mocks.file.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'file' },
        data: {
          ocrText: 'Receipt 123',
          ocrConfidence: 95,
          isOcrProcessed: true,
          ocrTagsPendingAt: now,
        },
      })
      expect(mocks.applyAutomaticTags).toHaveBeenCalledWith(
        'file',
        'ocr',
        transaction
      )
      expect(mocks.file.update.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.applyAutomaticTags.mock.invocationCallOrder[0]
      )
      expect(file.ocrTagsPendingAt).toBeNull()
    }
  )

  it('preserves extracted text and pending work when tagging fails', async () => {
    mocks.applyAutomaticTags.mockRejectedValue(
      new Error('Temporary tag failure')
    )
    await expect(processImageOCR('image.png', 'file')).resolves.toEqual({
      success: true,
      text: 'Receipt 123',
      confidence: 95,
    })
    expect(file).toMatchObject({
      isOcrProcessed: true,
      ocrText: 'Receipt 123',
      ocrConfidence: 95,
    })
    expect(file.ocrTagsPendingAt?.getTime()).toBeGreaterThan(now.getTime())
    expect(mocks.file.update).toHaveBeenCalledTimes(1)
  })

  it('does not apply rules when text extraction fails', async () => {
    mocks.recognize.mockRejectedValue(new Error('Unreadable image'))
    await expect(processImageOCR('image.png', 'file')).resolves.toMatchObject({
      success: false,
    })
    // The route reports a failure without the underlying error.
    const response = await getOcr()
    expect(await response.json()).toMatchObject({ success: false })
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
    expect(file.ocrTagsPendingAt).toBeNull()
  })
})

describe('cached OCR requests', () => {
  it('retries failed tags from cached text, then stops reapplying completed rules', async () => {
    mocks.applyAutomaticTags.mockRejectedValueOnce(
      new Error('Temporary tag failure')
    )
    const expected = { success: true, text: 'Receipt 123', confidence: 95 }

    const initial = await getOcr()
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual(expected)
    expect(file.ocrTagsPendingAt).not.toBeNull()

    const retry = await getOcr()
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(expected)
    expect(file.ocrTagsPendingAt).toBeNull()

    const cached = await getOcr()
    expect(cached.status).toBe(200)
    expect(await cached.json()).toEqual(expected)
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(2)
  })

  it('keeps returning cached text when retries continue to fail', async () => {
    mocks.applyAutomaticTags.mockRejectedValue(
      new Error('Temporary tag failure')
    )
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await getOcr()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        success: true,
        text: 'Receipt 123',
        confidence: 95,
      })
      expect(file.ocrTagsPendingAt).not.toBeNull()
    }
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(3)
    expect(file.ocrText).toBe('Receipt 123')
  })

  it('caches a successful empty OCR result without extracting or tagging it again', async () => {
    mocks.recognize.mockResolvedValue({ data: { text: '  ', confidence: 0 } })
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await getOcr()
      expect(await response.json()).toEqual({
        success: true,
        text: '',
        confidence: 0,
      })
    }
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(1)
    expect(file.ocrTagsPendingAt).toBeNull()
  })

  it('does not retry tags before checking access to private OCR text', async () => {
    Object.assign(file, {
      isOcrProcessed: true,
      ocrText: 'Receipt 123',
      ocrTagsPendingAt: now,
    })
    mocks.checkFileAccess.mockResolvedValue({
      allowed: false,
      reason: 'private',
      status: 401,
    })
    const response = await getOcr()
    expect(response.status).toBe(401)
    expect(mocks.recognize).not.toHaveBeenCalled()
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
    expect(file.ocrTagsPendingAt).toEqual(now)
  })
})
