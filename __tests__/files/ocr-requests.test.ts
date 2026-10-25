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

describe('OCR admission and waiting limits', () => {
  it('charges one requester once when several requests for one image arrive together', async () => {
    const { get } = await modules()
    // Spend all but one recognition from this requester's budget.
    for (let index = 0; index < 19; index++) {
      mocks.files.set(`spent-${index}`, image(`spent-${index}`))
      expect((await get(`spent-${index}`, '198.51.100.40')).status).toBe(200)
    }
    mocks.files.set('together', image('together'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'Together', confidence: 90 } }
    })

    const responses = Promise.all(
      [1, 2, 3].map(() => get('together', '198.51.100.40'))
    )
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(20))
    gate.resolve()
    // The first request starts the work with the last point; the others join it.
    expect((await responses).map((response) => response.status)).toEqual([
      200, 200, 200,
    ])
  })

  it('does not charge a request that the queue then refuses', async () => {
    const { ocrQueue } = await modules()
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'text', confidence: 70 } }
    })
    const free = async () => ({ refund: async () => undefined })
    // One running and nine queued leaves one queue place.
    const started = Array.from({ length: 10 }, (_, index) => {
      mocks.files.set(`full-${index}`, image(`full-${index}`))
      return ocrQueue.request(
        { fileId: `full-${index}`, filePath: `full-${index}` },
        { admit: free }
      )
    })
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())

    const charges: string[] = []
    const refunds: string[] = []
    const admitAs = (who: string) => async () => {
      charges.push(who)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { refund: async () => void refunds.push(who) }
    }
    for (const id of ['last-a', 'last-b']) mocks.files.set(id, image(id))
    const [first, second] = await Promise.all([
      ocrQueue
        .request(
          { fileId: 'last-a', filePath: 'last-a' },
          { admit: admitAs('a'), waitMs: 1 }
        )
        .then((outcome) => outcome.status),
      ocrQueue
        .request(
          { fileId: 'last-b', filePath: 'last-b' },
          { admit: admitAs('b'), waitMs: 1 }
        )
        .then((outcome) => outcome.status),
    ])
    expect([first, second].sort()).toEqual(['busy', 'pending'])
    // Whoever was refused kept its budget: charged never, or refunded.
    const refused = first === 'busy' ? 'a' : 'b'
    expect(charges.filter((who) => who === refused).length).toBe(
      refunds.filter((who) => who === refused).length
    )
    gate.resolve()
    await Promise.all(started)
    // Let the accepted request's work finish before the next test.
    await vi.waitFor(() => {
      expect(ocrQueue.getQueueLength()).toBe(0)
      expect(ocrQueue.getActiveProcesses()).toBe(0)
    })
  })

  it('refunds the charge when upload processing queues the same image meanwhile', async () => {
    const { ocrQueue } = await modules()
    mocks.files.set('raced', image('raced'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'Raced', confidence: 88 } }
    })
    const refund = vi.fn(async () => undefined)
    const request = ocrQueue.request(
      { fileId: 'raced', filePath: 'raced' },
      {
        admit: async () => {
          // Upload processing queues the same file while this request is charged.
          await ocrQueue.add({ fileId: 'raced', filePath: 'raced' }, true)
          return { refund }
        },
      }
    )
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())
    gate.resolve()
    expect(await request).toMatchObject({ status: 'done' })
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
    expect(refund).toHaveBeenCalledTimes(1)
  })

  it('caps live waiting requests, including ones that join queued work', async () => {
    const { get } = await modules()
    mocks.files.set('popular', image('popular'))
    const gate = deferred()
    mocks.recognize.mockImplementation(async () => {
      await gate.promise
      return { data: { text: 'Popular', confidence: 95 } }
    })

    const responses = Array.from({ length: 40 }, (_, index) =>
      get('popular', `198.51.100.${index + 1}`)
    )
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled())
    // Thirty wait for the one recognition; the rest are refused straight away.
    const refused = await Promise.all(
      responses.slice(30).map((response) => response)
    )
    for (const response of refused) {
      expect(response.status).toBe(503)
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    }
    // A request for another image is refused too while every place is taken.
    mocks.files.set('other', image('other'))
    expect((await get('other', '198.51.100.99')).status).toBe(503)

    gate.resolve()
    const waited = await Promise.all(responses.slice(0, 30))
    expect(waited.every((response) => response.status === 200)).toBe(true)
    expect(mocks.recognize).toHaveBeenCalledTimes(1)
  })
})

function never(): Promise<never> {
  return new Promise(() => undefined)
}
