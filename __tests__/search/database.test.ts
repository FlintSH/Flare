import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { docxOf, memoryStorage, pdfWithText, xlsxOf, zipOf } from './fixtures'

const state = vi.hoisted(() => ({
  userId: 'search-owner',
  ocr: true,
  documents: true,
  storage: null as unknown,
  recognize: null as unknown as (bytes: Buffer) => Promise<string>,
}))

vi.mock('@/lib/http/access', () => ({
  requireAccount: async () => ({ id: state.userId }),
}))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  getStorageProvider: async () => state.storage,
}))
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    getConfig: async () => {
      const config = structuredClone(actual.DEFAULT_CONFIG)
      config.settings.general.ocr.enabled = state.ocr
      config.settings.general.search.documents = state.documents
      return config
    },
  }
})
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: async (bytes: Buffer) => ({
      data: { text: await state.recognize(bytes), confidence: 90 },
    }),
    terminate: async () => undefined,
  }),
}))

const databaseUrl = process.env.FLARE_SEARCH_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

vi.setConfig({ testTimeout: 30_000 })

suite('library search against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let files: typeof import('@/app/api/files/route')
  let timeline: typeof import('@/app/api/files/timeline/route')
  let index: typeof import('@/app/api/files/search-index/route')
  let worker: typeof import('@/lib/search/worker')
  let store: typeof import('@/lib/search/store')
  let storage: ReturnType<typeof memoryStorage>

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['/flare_search_test', '/flare_search_test_ci'].includes(url.pathname)
    )
      throw new Error(
        'Use a local flare_search_test or flare_search_test_ci database; never a real one'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    files = await import('@/app/api/files/route')
    timeline = await import('@/app/api/files/timeline/route')
    index = await import('@/app/api/files/search-index/route')
    worker = await import('@/lib/search/worker')
    store = await import('@/lib/search/store')
  })

  beforeEach(async () => {
    storage = memoryStorage()
    state.storage = storage.provider
    state.ocr = true
    state.documents = true
    state.userId = 'search-owner'
    state.recognize = async (bytes) => {
      const text = bytes.toString('utf8')
      if (text.startsWith('BROKEN')) throw new Error('/srv/private/broken.png')
      return text.replace(/^IMAGE:/, '')
    }
    await prisma.auditEvent.deleteMany()
    await prisma.event.deleteMany()
    await prisma.user.deleteMany()
    for (const id of ['search-owner', 'search-other'])
      await prisma.user.create({
        data: { id, name: id, urlId: id, uploadToken: id },
      })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  let clock = Date.parse('2026-01-01T00:00:00.000Z')
  async function upload(
    name: string,
    mimeType: string,
    bytes: Buffer | string,
    overrides: Record<string, unknown> = {}
  ) {
    const id = randomUUID()
    const path = `uploads/${id}`
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    storage.objects.set(path, data)
    clock += 60_000
    const userId = (overrides.userId as string) ?? 'search-owner'
    const file = await prisma.file.create({
      data: {
        id,
        name,
        path,
        urlPath: `/${userId}/${id}`,
        userId,
        mimeType,
        size: data.length / 1024 / 1024,
        uploadedAt: new Date(clock),
        ...overrides,
      },
    })
    await prisma.fileSearchIndex.create({
      data: { fileId: id, userId, availableAt: new Date(clock) },
    })
    return file
  }

  async function indexEverything() {
    for (let round = 0; round < 50; round++)
      if (!(await worker.runSearchIndexBatch())) return
    throw new Error('indexing never finished')
  }

  async function row(fileId: string) {
    return prisma.fileSearchIndex.findUniqueOrThrow({ where: { fileId } })
  }

  async function search(query: string, params: Record<string, string> = {}) {
    const response = await files.GET(
      new Request(
        `http://localhost/api/files?${new URLSearchParams({ search: query, ...params })}`
      )
    )
    expect(response.status).toBe(200)
    return (await response.json()) as {
      data: {
        id: string
        name: string
        match: import('@/lib/search/query').FileMatch | null
        searchIndex: {
          state: string
          source: string | null
          reason: string | null
        }
      }[]
      pagination: { total: number }
    }
  }
  const names = async (query: string, params?: Record<string, string>) =>
    (await search(query, params)).data.map((file) => file.name)
  const text = (segments: { text: string }[]) =>
    segments.map((segment) => segment.text).join('')
  const marked = (segments: { text: string; match?: true }[]) =>
    segments.filter((segment) => segment.match).map((segment) => segment.text)

  it('reads each kind of file, and explains why it couldn’t', async () => {
    const note = await upload(
      'notes.md',
      'text/markdown',
      '# Plans\nCall the plumber on Tuesday'
    )
    const paste = await upload(
      'paste-8f2a.txt',
      'text/plain',
      'ssh deploy@10.0.4.12',
      { isPaste: true }
    )
    const svg = await upload(
      'logo.svg',
      'image/svg+xml',
      '<svg><title>Acme Rocket</title><text>Launch</text></svg>'
    )
    const pdf = await upload(
      'scan0001.pdf',
      'application/pdf',
      pdfWithText(['Invoice 2024-117', 'Total due: 420.00 EUR'])
    )
    const docx = await upload(
      'final_FINAL(2).docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      await docxOf(['Quarterly retrospective', 'Ship the onboarding flow'])
    )
    const xlsx = await upload(
      'Book1.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      await xlsxOf(['Mileage', 'Fuel receipts'])
    )
    const zip = await upload(
      'stuff.zip',
      'application/zip',
      await zipOf({ 'taxes/2024/w2-employer.pdf': 'x', 'readme.txt': 'hi' })
    )
    const image = await upload(
      'IMG_20240301_093012.jpg',
      'image/jpeg',
      'IMAGE:Boarding pass gate B22'
    )
    // Recognition reads stray marks in a photo without text.
    const blank = await upload(
      'Screenshot 2026-10-04 at 11.32.07.png',
      'image/png',
      'IMAGE: a » '
    )
    const broken = await upload('photo.png', 'image/png', 'BROKEN')
    const damaged = await upload(
      'report.pdf',
      'application/pdf',
      'not really a pdf'
    )
    const binary = await upload(
      'data.txt',
      'text/plain',
      Buffer.from([0, 1, 2, 0, 0, 0, 255, 0, 3, 0])
    )
    const video = await upload('clip.mp4', 'video/mp4', 'video bytes')
    const heic = await upload('IMG_0042.HEIC', 'image/heic', 'heic bytes')

    await indexEverything()
    expect(await row(note.id)).toMatchObject({
      status: 'INDEXED',
      source: 'text',
      content: '# Plans Call the plumber on Tuesday',
    })
    expect(await row(paste.id)).toMatchObject({
      status: 'INDEXED',
      source: 'text',
    })
    expect(await row(svg.id)).toMatchObject({
      status: 'INDEXED',
      content: 'Acme Rocket Launch',
    })
    expect(await row(pdf.id)).toMatchObject({
      status: 'INDEXED',
      source: 'pdf',
    })
    expect((await row(pdf.id)).content).toContain('Total due: 420.00 EUR')
    expect(await row(docx.id)).toMatchObject({
      status: 'INDEXED',
      source: 'document',
      content: 'Quarterly retrospective Ship the onboarding flow',
    })
    expect((await row(xlsx.id)).content).toBe('Mileage Fuel receipts')
    expect(await row(zip.id)).toMatchObject({
      status: 'INDEXED',
      source: 'archive',
      entries: 'taxes/2024/w2-employer.pdf\nreadme.txt',
    })
    expect(await row(image.id)).toMatchObject({
      status: 'INDEXED',
      source: 'ocr',
      content: 'Boarding pass gate B22',
    })
    expect(await row(blank.id)).toMatchObject({
      status: 'EMPTY',
      reason: 'No text was found in this image.',
    })
    expect(await row(damaged.id)).toMatchObject({
      status: 'FAILED',
      reason: 'Flare couldn’t read this PDF. It may be damaged.',
    })
    expect(await row(binary.id)).toMatchObject({ status: 'UNSUPPORTED' })
    expect(await row(video.id)).toMatchObject({
      status: 'UNSUPPORTED',
      reason: null,
    })
    expect(await row(heic.id)).toMatchObject({
      status: 'UNSUPPORTED',
      reason: 'Flare can’t recognize text in this image format.',
    })

    // A recognition failure is retried later, then reported without its error.
    let failed = await row(broken.id)
    expect(failed).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      reason: 'Flare couldn’t read text from this image.',
    })
    for (let attempt = 2; attempt <= 3; attempt++) {
      await prisma.fileSearchIndex.update({
        where: { fileId: broken.id },
        data: { availableAt: new Date(0) },
      })
      await indexEverything()
    }
    failed = await row(broken.id)
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 3 })
    expect(JSON.stringify(failed)).not.toContain('/srv/private')
  })

  it('reuses text recognized before instead of reading the image again', async () => {
    state.recognize = async () => {
      throw new Error('should not run')
    }
    const image = await upload('IMG_1.png', 'image/png', 'pixels', {
      ocrText: 'Wifi password hunter2',
      isOcrProcessed: true,
    })
    await indexEverything()
    expect(await row(image.id)).toMatchObject({
      status: 'INDEXED',
      content: 'Wifi password hunter2',
    })
  })

  it('skips what settings turn off, and reads it once they are on again', async () => {
    state.ocr = false
    state.documents = false
    const image = await upload('receipt.png', 'image/png', 'IMAGE:Coffee 4.50')
    const pdf = await upload(
      'lease.pdf',
      'application/pdf',
      pdfWithText(['Lease agreement'])
    )
    const note = await upload('todo.txt', 'text/plain', 'milk')
    await indexEverything()
    expect(await row(image.id)).toMatchObject({
      status: 'SKIPPED',
      reason: store.OCR_OFF_REASON,
    })
    expect(await row(pdf.id)).toMatchObject({
      status: 'SKIPPED',
      reason: store.DOCUMENTS_OFF_REASON,
    })
    expect(await row(note.id)).toMatchObject({ status: 'SKIPPED' })
    // Names still match while contents aren't read.
    expect(await names('lease')).toEqual(['lease.pdf'])

    state.ocr = true
    expect(await store.requeueOutdated({ ocr: true, documents: false })).toBe(1)
    await indexEverything()
    expect(await row(image.id)).toMatchObject({ status: 'INDEXED' })
    expect(await row(pdf.id)).toMatchObject({ status: 'SKIPPED' })
    state.documents = true
    expect(await store.requeueOutdated({ ocr: true, documents: true })).toBe(2)
    await indexEverything()
    expect(await row(pdf.id)).toMatchObject({ status: 'INDEXED' })
  })

  it('finds messy names without the exact filename', async () => {
    await upload('IMG_20240301_093012.jpg', 'image/jpeg', 'IMAGE:')
    await upload(
      'Screenshot 2026-10-04 at 11.32.07 PM.png',
      'image/png',
      'IMAGE:'
    )
    await upload('final_FINAL(2).docx', 'application/octet-stream', 'x')
    await upload('Résumé – Jane Doe.pdf', 'application/octet-stream', 'x')
    await upload('ProjectPlanV3.key', 'application/octet-stream', 'x')
    await indexEverything()

    expect(await names('20240301')).toEqual(['IMG_20240301_093012.jpg'])
    expect(await names('2024-03-01')).toEqual(['IMG_20240301_093012.jpg'])
    expect(await names('screenshot 2026-10-04')).toEqual([
      'Screenshot 2026-10-04 at 11.32.07 PM.png',
    ])
    expect(await names('11.32')).toEqual([
      'Screenshot 2026-10-04 at 11.32.07 PM.png',
    ])
    expect(await names('final final')).toEqual(['final_FINAL(2).docx'])
    expect(await names('finalfinal2')).toEqual(['final_FINAL(2).docx'])
    expect(await names('resume jane')).toEqual(['Résumé – Jane Doe.pdf'])
    expect(await names('RÉSUMÉ')).toEqual(['Résumé – Jane Doe.pdf'])
    expect(await names('project plan')).toEqual(['ProjectPlanV3.key'])
    // Words, prefixes and exclusions combine.
    expect(await names('type:pdf')).toEqual(['Résumé – Jane Doe.pdf'])
    expect(await names('-final type:docx')).toEqual([])
    expect(await names('name:"jane doe"')).toEqual(['Résumé – Jane Doe.pdf'])
  })

  it('finds files by what is inside them and shows where', async () => {
    const pdf = await upload(
      'scan0001.pdf',
      'application/pdf',
      pdfWithText(['ACME Corp', 'Invoice 2024-117', 'Total due: 420.00 EUR'])
    )
    await upload(
      'IMG_4471.jpg',
      'image/jpeg',
      'IMAGE:Boarding pass. Gate B22. Flight LH 1234 to Lisbon'
    )
    await upload(
      'backup.zip',
      'application/zip',
      await zipOf({
        'taxes/2024/W2-employer.pdf': 'x',
        'photos/lisbon.jpg': 'y',
      })
    )
    await upload('invoice-template.docx', 'application/octet-stream', 'x')
    await indexEverything()

    // A name match outranks one found only inside a file.
    expect(await names('invoice')).toEqual([
      'invoice-template.docx',
      'scan0001.pdf',
    ])
    const result = await search('invoices total')
    expect(result.data.map((file) => file.name)).toEqual(['scan0001.pdf'])
    expect(result.data[0].id).toBe(pdf.id)
    expect(result.data[0].match).toMatchObject({
      name: false,
      tags: [],
      folder: null,
      entries: null,
    })
    expect(result.data[0].match?.content?.source).toBe('pdf')
    expect(text(result.data[0].match!.content!.snippet)).toContain(
      'Invoice 2024-117'
    )
    expect(marked(result.data[0].match!.content!.snippet)).toEqual([
      'Invoice',
      'Total',
    ])

    const lisbon = await search('lisbon')
    expect(lisbon.data.map((file) => file.name).sort()).toEqual([
      'IMG_4471.jpg',
      'backup.zip',
    ])
    const zip = lisbon.data.find((file) => file.name === 'backup.zip')!
    expect(zip.match?.entries?.paths.map(text)).toEqual(['photos/lisbon.jpg'])
    expect(
      (await search('text:"gate b22"')).data[0].match?.content?.source
    ).toBe('ocr')
    expect(await names('"b22 gate"')).toEqual([])
    expect(await names('w2 employer')).toEqual(['backup.zip'])
    const phrase = await search('"w2 employer"')
    expect(phrase.data[0].match?.entries?.paths.map(text)).toEqual([
      'taxes/2024/W2-employer.pdf',
    ])
    expect(phrase.data[0].match?.entries?.paths.map(marked)).toEqual([
      ['W2-employer'],
    ])
    // An unknown prefix that names an object property is just text.
    expect(await names('constructor:foo')).toEqual([])
    expect(await names('type:constructor')).toEqual([])
    expect(await names('name:lisbon')).toEqual([])
  })

  it('falls back to files with some of the words when none has them all', async () => {
    await upload(
      'Screenshot 2026-10-04.png',
      'image/png',
      'IMAGE:Wireless settings Network Pinecone Password hunter2'
    )
    await upload(
      'wifi-router-manual.pdf',
      'application/pdf',
      pdfWithText(['Router manual'])
    )
    await upload('unrelated.txt', 'text/plain', 'nothing')
    await indexEverything()

    const result = await search('wifi password')
    expect(result.data.map((file) => file.name).sort()).toEqual([
      'Screenshot 2026-10-04.png',
      'wifi-router-manual.pdf',
    ])
    const screenshot = result.data.find((file) =>
      file.name.startsWith('Screenshot')
    )!
    expect(screenshot.match?.missing).toEqual(['wifi'])
    expect(
      result.data.find((file) => file.name.startsWith('wifi'))!.match?.missing
    ).toEqual(['password'])
    const response = await timeline.GET(
      new Request(
        `http://localhost/api/files/timeline?search=wifi+password&sortBy=relevance`
      )
    )
    expect((await response.json()).data).toMatchObject({
      total: 2,
      searchMatch: 'some',
    })
    // Every word matching somewhere keeps the list strict, with nothing missing.
    const strict = await search('wireless password')
    expect(strict.data.map((file) => file.name)).toEqual([
      'Screenshot 2026-10-04.png',
    ])
    expect(strict.data[0].match?.missing).toEqual([])
    // Exclusions and places stay required in the fallback.
    expect(await names('wifi password -router')).toEqual([
      'Screenshot 2026-10-04.png',
    ])
    expect(await names('wifi password type:pdf')).toEqual([
      'wifi-router-manual.pdf',
    ])
  })

  it('matches tags and folder paths, and never another account’s files', async () => {
    const tag = await prisma.vaultTag.create({
      data: {
        userId: 'search-owner',
        name: 'Receipts',
        normalizedName: 'receipts',
      },
    })
    const otherTag = await prisma.vaultTag.create({
      data: {
        userId: 'search-other',
        name: 'Lisbon',
        normalizedName: 'lisbon',
      },
    })
    const taxes = await prisma.vaultFolder.create({
      data: { userId: 'search-owner', name: 'Taxes', normalizedName: 'taxes' },
    })
    const year = await prisma.vaultFolder.create({
      data: {
        userId: 'search-owner',
        name: '2024',
        normalizedName: '2024',
        parentId: taxes.id,
      },
    })
    const tagged = await upload('a.png', 'image/png', 'IMAGE:')
    await prisma.vaultFileTag.create({
      data: { fileId: tagged.id, tagId: tag.id },
    })
    await upload('b.pdf', 'application/pdf', pdfWithText(['nothing']), {
      folderId: year.id,
    })
    const theirs = await upload(
      'lisbon trip.txt',
      'text/plain',
      'Lisbon hotel receipts',
      { userId: 'search-other' }
    )
    await prisma.vaultFileTag.create({
      data: { fileId: theirs.id, tagId: otherTag.id },
    })
    await upload('mine.txt', 'text/plain', 'nothing here')
    await indexEverything()

    const receipts = await search('receipt')
    expect(receipts.data.map((file) => file.name)).toEqual(['a.png'])
    expect(receipts.data[0].match?.tags).toEqual([
      { id: tag.id, name: 'Receipts' },
    ])
    const folder = await search('taxes 2024')
    expect(folder.data.map((file) => file.name)).toEqual(['b.pdf'])
    expect(folder.data[0].match?.folder).toEqual({
      id: year.id,
      path: 'Taxes / 2024',
    })
    expect(await names('in:taxes')).toEqual(['b.pdf'])
    // Unfiled files have no folder, which must not hide them from exclusions.
    expect((await names('-in:taxes')).sort()).toEqual(['a.png', 'mine.txt'])
    expect(await names('tag:receipts')).toEqual(['a.png'])
    // The other account's words, tags and file never show up.
    expect(await names('lisbon')).toEqual([])
    expect(await names('hotel')).toEqual([])
    state.userId = 'search-other'
    expect(await names('lisbon')).toEqual(['lisbon trip.txt'])
    expect(await names('receipt')).toEqual(['lisbon trip.txt'])
  })

  it('combines a search with filters, pages, gallery and timeline', async () => {
    for (let n = 1; n <= 5; n++)
      await upload(`holiday-${n}.png`, 'image/png', `IMAGE:beach day ${n}`)
    await upload(
      'holiday plan.txt',
      'text/plain',
      'beach packing list '.repeat(400)
    )
    await upload('unrelated.png', 'image/png', 'IMAGE:mountains')
    await indexEverything()

    expect((await search('beach')).pagination.total).toBe(6)
    expect(await names('beach', { types: 'text/plain' })).toEqual([
      'holiday plan.txt',
    ])
    expect(await names('beach', { minSize: '1000' })).toEqual([
      'holiday plan.txt',
    ])
    expect((await search('beach', { maxSize: '1000' })).pagination.total).toBe(
      5
    )
    expect(await names('beach', { index: 'failed' })).toEqual([])

    const ranked = await search('beach', {
      sortBy: 'relevance',
      limit: '2',
      page: '2',
    })
    expect(ranked.pagination.total).toBe(6)
    expect(ranked.data).toHaveLength(2)
    const all = (
      await search('beach', { sortBy: 'relevance', limit: '100' })
    ).data.map((file) => file.id)
    expect(ranked.data.map((file) => file.id)).toEqual(all.slice(2, 4))
    // A page past the end still reports how many files match.
    const beyond = await search('beach', {
      sortBy: 'relevance',
      limit: '2',
      page: '9',
    })
    expect(beyond).toMatchObject({ data: [], pagination: { total: 6 } })
    // Equal scores list newest first, like the library.
    expect((await names('holiday', { sortBy: 'relevance' }))[0]).toBe(
      'holiday plan.txt'
    )
    expect(await names('holiday', { sortBy: 'oldest', limit: '2' })).toEqual([
      'holiday-1.png',
      'holiday-2.png',
    ])

    const images = (
      await search('beach', { sortBy: 'relevance', limit: '100' })
    ).data.filter((file) => file.name.endsWith('.png'))
    const gallery = await files.GET(
      new Request(
        `http://localhost/api/files?${new URLSearchParams({ search: 'beach', sortBy: 'relevance', galleryAnchor: images[1].id, galleryDirection: 'next', limit: '2' })}`
      )
    )
    const neighbors = await gallery.json()
    expect(neighbors.data.map((file: { id: string }) => file.id)).toEqual([
      images[2].id,
      images[3].id,
    ])
    expect(neighbors.pagination).toMatchObject({ total: 5, offset: 2 })

    const response = await timeline.GET(
      new Request(
        `http://localhost/api/files/timeline?${new URLSearchParams({ search: 'beach', sortBy: 'relevance', groupBy: 'month' })}`
      )
    )
    const body = (await response.json()).data
    expect(body).toMatchObject({
      total: 6,
      groupBy: 'none',
      buckets: [{ key: 'all', count: 6 }],
    })
    // Content indexed after a list's snapshot waits for the next refresh.
    const late = await upload('late.txt', 'text/plain', 'beach')
    await indexEverything()
    expect(
      (await search('beach', { snapshot: body.snapshot })).data.map(
        (file) => file.id
      )
    ).not.toContain(late.id)
  })

  it('reports and retries the index for the caller only', async () => {
    const broken = await upload('broken.pdf', 'application/pdf', 'nope')
    await upload('fine.txt', 'text/plain', 'hello')
    await upload('theirs.pdf', 'application/pdf', 'nope', {
      userId: 'search-other',
    })
    await indexEverything()
    const summary = await (
      await index.GET(new Request('http://localhost/api/files/search-index'))
    ).json()
    expect(summary.data).toMatchObject({
      total: 2,
      counts: { indexed: 1, failed: 1, waiting: 0 },
      reads: { imageText: true, documents: true },
    })
    const retry = await index.POST(
      new Request('http://localhost/api/files/search-index', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ failed: true }),
      })
    )
    expect((await retry.json()).data).toEqual({ queued: 1 })
    expect(await row(broken.id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    })
    expect(
      (
        await prisma.fileSearchIndex.findMany({
          where: { userId: 'search-other' },
        })
      )[0].status
    ).toBe('FAILED')
    expect(await names('broken', { index: 'waiting' })).toEqual(['broken.pdf'])
  })
})
