import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FileRow = {
  id: string
  name: string
  userId: string
  mimeType: string
  path: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  isOcrProcessed: boolean
  ocrText: string | null
  ocrConfidence: number | null
  ocrTagsPendingAt: Date | null
}

const mocks = vi.hoisted(() => ({
  files: new Map<string, FileRow>(),
  recognize: vi.fn(),
  session: null as { user: { id: string } } | null,
  ocrEnabled: true,
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const file = mocks.files.get(where.id)
        return file ? { ...file } : null
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Partial<FileRow>
      }) => {
        const file = mocks.files.get(where.id)
        if (!file) throw new Error('missing file')
        Object.assign(file, data)
        return { ...file }
      },
    },
  },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => mocks.session }))
vi.mock('@/lib/files/access', () => ({
  checkFileAccess: async () => ({
    allowed: true,
    isOwner: false,
    canModerate: false,
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileStream: async () => Readable.from([Buffer.from('image bytes')]),
  }),
}))
vi.mock('@/lib/tags/ocr', () => ({
  applyPendingOcrTags: async () => undefined,
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: { general: { ocr: { enabled: mocks.ocrEnabled } } },
  }),
}))
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: mocks.recognize,
    terminate: async () => undefined,
  }),
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

function image(id: string, overrides: Partial<FileRow> = {}): FileRow {
  return {
    id,
    name: `${id}.png`,
    userId: 'owner',
    mimeType: 'image/png',
    path: `uploads/owner/${id}/${id}.png`,
    visibility: 'PUBLIC',
    password: null,
    isOcrProcessed: false,
    ocrText: null,
    ocrConfidence: null,
    ocrTagsPendingAt: null,
    ...overrides,
  }
}

async function modules() {
  const [{ GET }, { ocrQueue }, { configureAuditWriter }] = await Promise.all([
    import('@/app/api/files/[id]/ocr/route'),
    import('@/lib/ocr'),
    import('@/lib/audit'),
  ])
  configureAuditWriter(async () => undefined)
  const get = (id: string, ip = '203.0.113.10') =>
    GET(
      new Request(`https://flare.test/api/files/${id}/ocr`, {
        headers: { 'x-real-ip': ip },
      }),
      { params: Promise.resolve({ id }) }
    )
  return { get, ocrQueue }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))
  mocks.files.clear()
  mocks.recognize.mockReset()
  mocks.recognize.mockResolvedValue({
    data: { text: ' Receipt 123 ', confidence: 91 },
  })
  mocks.session = null
  mocks.ocrEnabled = true
})
afterEach(() => vi.useRealTimers())

describe('on-demand OCR requests', () => {
  it('runs one recognition for simultaneous requests for the same image', async () => {
    const { get } = await modules()
    mocks.files.set('shared', image('shared'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: ' Receipt 123 ', confidence: 91 } }
    })

    const responses = Promise.all(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3'].map((ip) =>
        get('shared', ip)
      )
    )
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())
    gate.resolve()

    for (const response of await responses) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        success: true,
        text: 'Receipt 123',
        confidence: 91,
      })
    }
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
  })

  it('shares a recognition already queued by upload processing', async () => {
    const { get, ocrQueue } = await modules()
    mocks.files.set('uploaded', image('uploaded'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'From upload', confidence: 80 } }
    })

    await ocrQueue.add({
      fileId: 'uploaded',
      filePath: 'uploads/owner/uploaded/uploaded.png',
    })
    const response = get('uploaded')
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())
    gate.resolve()

    expect((await response).status).toBe(200)
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
  })

  it('does not repeat a failed recognition on every request or reveal its error', async () => {
    const { get } = await modules()
    mocks.files.set('broken', image('broken'))
    mocks.recognize.mockRejectedValue(
      new Error('ENOENT: /srv/flare/uploads/private-path/broken.png')
    )

    const first = await get('broken', '198.51.100.1')
    expect(first.status).toBe(200)
    const failure = await first.json()
    expect(failure.success).toBe(false)
    expect(JSON.stringify(failure)).not.toContain('private-path')

    const second = await get('broken', '198.51.100.2')
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ success: false })
    expect(mocks.recognize).toHaveBeenCalledTimes(1)

    // After the cool-down another request may try again.
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    await get('broken', '198.51.100.3')
    expect(mocks.recognize).toHaveBeenCalledTimes(2)
  })

  it('limits how often one requester can start recognition, but not cached reads', async () => {
    const { get } = await modules()
    mocks.files.set(
      'done',
      image('done', {
        isOcrProcessed: true,
        ocrText: 'Already extracted',
        ocrConfidence: 88,
      })
    )
    const limit = 20
    for (let index = 0; index < limit; index++) {
      mocks.files.set(`new-${index}`, image(`new-${index}`))
      expect((await get(`new-${index}`, '198.51.100.7')).status).toBe(200)
    }
    mocks.files.set('one-more', image('one-more'))
    const limited = await get('one-more', '198.51.100.7')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await limited.json()).error).toMatch(/try again/i)
    expect(mocks.recognize).toHaveBeenCalledTimes(limit)

    // Cached text costs no recognition, and other requesters keep their own budget.
    const cached = await get('done', '198.51.100.7')
    expect(cached.status).toBe(200)
    expect(await cached.json()).toEqual({
      success: true,
      text: 'Already extracted',
      confidence: 88,
    })
    expect((await get('one-more', '198.51.100.8')).status).toBe(200)
  })

  it('counts a signed-in account once across addresses', async () => {
    const { get } = await modules()
    mocks.session = { user: { id: 'reader' } }
    for (let index = 0; index < 20; index++) {
      mocks.files.set(`img-${index}`, image(`img-${index}`))
      expect((await get(`img-${index}`, `198.51.100.${index}`)).status).toBe(
        200
      )
    }
    mocks.files.set('last', image('last'))
    expect((await get('last', '198.51.100.99')).status).toBe(429)
  })

  it('refuses new work with 503 when too many requests are already waiting', async () => {
    const { get } = await modules()
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'text', confidence: 70 } }
    })
    const ids = Array.from({ length: 12 }, (_, index) => `queued-${index}`)
    for (const id of ids) mocks.files.set(id, image(id))

    const responses = ids.map((id, index) => get(id, `198.51.100.${index}`))
    // One recognition runs and ten wait; the twelfth is refused straight away.
    const refused = await Promise.race(
      responses.map((response) =>
        response.then((value) => (value.status === 503 ? value : never()))
      )
    )
    expect(refused.status).toBe(503)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await refused.json()).error).toMatch(/busy/i)

    gate.resolve()
    const statuses = (await Promise.all(responses)).map((value) => value.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(11)
    expect(statuses.filter((status) => status === 503)).toHaveLength(1)
    expect(mocks.recognize).toHaveBeenCalledTimes(11)
  })

  it('answers 202 after the wait limit and keeps the work for a later request', async () => {
    const { get } = await modules()
    mocks.files.set('slow', image('slow'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: ' Slow receipt ', confidence: 77 } }
    })

    let settled = false
    const response = get('slow').then((value) => {
      settled = true
      return value
    })
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(settled).toBe(true))
    const pending = await response
    expect(pending.status).toBe(202)
    expect(Number(pending.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await pending.json()).toMatchObject({
      success: false,
      status: 'processing',
    })

    gate.resolve()
    await vi.waitFor(() =>
      expect(mocks.files.get('slow')?.ocrText).toBe('Slow receipt')
    )
    const later = await get('slow')
    expect(await later.json()).toEqual({
      success: true,
      text: 'Slow receipt',
      confidence: 77,
    })
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
  })

  it('still extracts text on request when automatic OCR is disabled', async () => {
    const { get } = await modules()
    mocks.ocrEnabled = false
    mocks.files.set('manual', image('manual'))
    const response = await get('manual')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      text: 'Receipt 123',
      confidence: 91,
    })
  })
})

function never(): Promise<never> {
  return new Promise(() => undefined)
}
