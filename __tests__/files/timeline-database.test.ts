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

const authentication = vi.hoisted(() => ({ userId: 'timeline-owner' }))
vi.mock('@/lib/auth/api-auth', () => ({
  requireAuth: async () => ({
    user: { id: authentication.userId },
    response: null,
  }),
}))

const databaseUrl = process.env.FLARE_TIMELINE_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('file timeline against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let timeline: typeof import('@/app/api/files/timeline/route')
  let files: typeof import('@/app/api/files/route')
  let memberships: typeof import('@/app/api/files/tags/route')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['/flare_timeline_test_api', '/flare_timeline_test_ci'].includes(
        url.pathname
      ) ||
      !!url.hash ||
      [...url.searchParams].length > 1 ||
      [...url.searchParams].some(
        ([key, value]) => key !== 'schema' || value !== 'public'
      )
    )
      throw new Error(
        'Use local flare_timeline_test_api or flare_timeline_test_ci with the public schema; never the browser demo database'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    timeline = await import('@/app/api/files/timeline/route')
    files = await import('@/app/api/files/route')
    memberships = await import('@/app/api/files/tags/route')
  })

  beforeEach(async () => {
    await prisma.event.deleteMany()
    await prisma.user.deleteMany()
    for (const id of ['timeline-owner', 'timeline-other'])
      await prisma.user.create({
        data: { id, name: id, urlId: id, uploadToken: id },
      })
    authentication.userId = 'timeline-owner'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  async function file(
    uploadedAt: string,
    overrides: Record<string, unknown> = {}
  ) {
    const id = randomUUID()
    return prisma.file.create({
      data: {
        id,
        name: `${id}.png`,
        path: `uploads/${id}`,
        urlPath: `/timeline-owner/${id}`,
        userId: 'timeline-owner',
        mimeType: 'image/png',
        size: 1,
        uploadedAt: new Date(uploadedAt),
        ...overrides,
      },
    })
  }
  function request(path: string, params: Record<string, string> = {}) {
    return new Request(
      `http://localhost/api/files${path}?${new URLSearchParams(params)}`
    )
  }
  async function getTimeline(params: Record<string, string> = {}) {
    const response = await timeline.GET(request('/timeline', params))
    expect(response.status).toBe(200)
    return (await response.json())
      .data as import('@/lib/files/timeline').FileTimeline
  }
  async function getFiles(params: Record<string, string>) {
    const response = await files.GET(request('', params))
    expect(response.status).toBe(200)
    return response.json()
  }

  it('reads current tag memberships for the selected files after mutations, excluding removed and foreign tags', async () => {
    const first = await file('2025-01-01T00:00:00.000Z')
    const second = await file('2025-01-02T00:00:00.000Z')
    await prisma.vaultTag.createMany({
      data: [
        {
          id: 'alpha',
          userId: 'timeline-owner',
          name: 'Alpha',
          normalizedName: 'alpha',
        },
        {
          id: 'zulu',
          userId: 'timeline-owner',
          name: 'Zulu',
          normalizedName: 'zulu',
        },
        {
          id: 'excluded',
          userId: 'timeline-owner',
          name: 'Removed',
          normalizedName: 'removed',
        },
        {
          id: 'foreign',
          userId: 'timeline-other',
          name: 'Private tag',
          normalizedName: 'private tag',
        },
      ],
    })
    await prisma.vaultFileTag.createMany({
      data: [
        { fileId: first.id, tagId: 'zulu' },
        { fileId: first.id, tagId: 'alpha' },
        { fileId: first.id, tagId: 'excluded', excluded: true },
        { fileId: first.id, tagId: 'foreign' },
      ],
    })
    const read = () =>
      memberships.GET(
        request('/tags', {
          fileIds: `${second.id},${first.id},${first.id}`,
        })
      )
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await response.json()).data.files).toEqual([
      { id: second.id, tags: [] },
      {
        id: first.id,
        tags: [
          { id: 'alpha', name: 'Alpha' },
          { id: 'zulu', name: 'Zulu' },
        ],
      },
    ])
    await prisma.vaultFileTag.updateMany({
      where: { fileId: first.id, tagId: 'alpha' },
      data: { excluded: true },
    })
    await prisma.vaultFileTag.create({
      data: { fileId: second.id, tagId: 'alpha' },
    })
    expect((await (await read()).json()).data.files).toEqual([
      { id: second.id, tags: [{ id: 'alpha', name: 'Alpha' }] },
      { id: first.id, tags: [{ id: 'zulu', name: 'Zulu' }] },
    ])
  })

  it('rejects mixed-owner and deleted tag selections with the same unavailable response', async () => {
    const owned = await file('2025-01-01T00:00:00.000Z')
    const foreign = await file('2025-01-01T00:00:00.000Z', {
      userId: 'timeline-other',
    })
    const responses = []
    for (const unavailable of [foreign.id, 'missing']) {
      const response = await memberships.GET(
        request('/tags', {
          fileIds: `${owned.id},${unavailable}`,
        })
      )
      expect(response.status).toBe(404)
      responses.push(await response.json())
    }
    expect(responses[0]).toEqual(responses[1])
    expect(responses[0]).toMatchObject({
      error: 'One or more files are no longer available.',
    })
    await prisma.file.delete({ where: { id: owned.id } })
    expect(
      (await memberships.GET(request('/tags', { fileIds: owned.id }))).status
    ).toBe(404)
  })

  it('counts all owned files by month without leaking other accounts and preserves stable page ties', async () => {
    const uploadedAt = '2025-03-05T12:00:00.000Z'
    const rows = await Promise.all(
      Array.from({ length: 109 }, () => file(uploadedAt))
    )
    await file('2025-02-01T00:00:00.000Z')
    await file(uploadedAt, { userId: 'timeline-other' })
    const result = await getTimeline()
    expect(result.total).toBe(110)
    expect(
      result.buckets.map((bucket) => [bucket.from, bucket.count, bucket.offset])
    ).toEqual([
      ['2025-03-01T00:00:00.000Z', 109, 0],
      ['2025-02-01T00:00:00.000Z', 1, 109],
    ])
    const params = {
      snapshot: result.snapshot,
      dateFrom: result.buckets[0].from!,
      dateTo: new Date(
        new Date(result.buckets[0].to!).getTime() - 1
      ).toISOString(),
      limit: '48',
    }
    const pages = await Promise.all(
      ['1', '2', '3'].map((page) => getFiles({ ...params, page }))
    )
    const ids = pages.flatMap((page) =>
      page.data.map((row: { id: string }) => row.id)
    )
    expect(ids).toEqual(rows.map((row) => row.id).sort())
    expect(new Set(ids).size).toBe(109)
    expect((await getTimeline({ sortBy: 'oldest' })).buckets[0].count).toBe(1)
  })

  it('uses local month/year boundaries and Monday weeks across daylight saving changes', async () => {
    await file('2025-03-01T07:30:00.000Z') // February in Los Angeles
    await file('2025-03-09T09:59:59.000Z')
    await file('2025-03-09T10:00:00.000Z')
    const months = await getTimeline({ timezone: 'America/Los_Angeles' })
    expect(
      months.buckets.map(({ from, to, count }) => [from, to, count])
    ).toEqual([
      ['2025-03-01T08:00:00.000Z', '2025-04-01T07:00:00.000Z', 2],
      ['2025-02-01T08:00:00.000Z', '2025-03-01T08:00:00.000Z', 1],
    ])
    const weeks = await getTimeline({
      timezone: 'America/Los_Angeles',
      groupBy: 'week',
    })
    expect(weeks.buckets[0]).toMatchObject({
      from: '2025-03-03T08:00:00.000Z',
      to: '2025-03-10T07:00:00.000Z',
      count: 2,
    })
    const years = await getTimeline({
      timezone: 'Pacific/Kiritimati',
      groupBy: 'year',
    })
    expect(years.buckets[0]).toMatchObject({
      from: '2024-12-31T10:00:00.000Z',
      to: '2025-12-31T10:00:00.000Z',
      count: 3,
    })
  })

  it('keeps SQL aggregates and metadata pages equivalent for every filter, including excluded tags and foreign IDs', async () => {
    await prisma.vaultFolder.createMany({
      data: [
        {
          id: 'own-folder',
          userId: 'timeline-owner',
          name: 'Own',
          normalizedName: 'own',
        },
        {
          id: 'other-folder',
          userId: 'timeline-other',
          name: 'Other',
          normalizedName: 'other',
        },
      ],
    })
    await prisma.vaultTag.createMany({
      data: [
        {
          id: 'own-tag',
          userId: 'timeline-owner',
          name: 'Own',
          normalizedName: 'own',
        },
        {
          id: 'other-tag',
          userId: 'timeline-other',
          name: 'Other',
          normalizedName: 'other',
        },
      ],
    })
    const own = await file('2025-03-15T12:00:00.000Z', {
      folderId: 'own-folder',
      visibility: 'PRIVATE',
      ocrText: 'Travel invoice',
    })
    const excluded = await file('2025-02-15T12:00:00.000Z', {
      name: 'invoice.jpg',
      mimeType: 'image/jpeg',
      password: 'hash',
    })
    await file('2025-01-15T12:00:00.000Z')
    await file('2025-03-15T12:00:00.000Z', {
      userId: 'timeline-other',
      folderId: 'other-folder',
    })
    await prisma.vaultFileTag.createMany({
      data: [
        { fileId: own.id, tagId: 'own-tag' },
        { fileId: excluded.id, tagId: 'own-tag', excluded: true },
      ],
    })
    for (const params of [
      { search: 'INVOICE' },
      { search: "' OR true --" },
      { types: 'image/jpeg' },
      { types: 'image/png,image/jpeg', visibility: 'private,hasPassword' },
      { visibility: 'public' },
      { visibility: 'hasPassword' },
      { folder: 'unfiled' },
      { folder: 'own-folder' },
      { folder: 'other-folder' },
      { tag: 'own-tag' },
      { tag: 'other-tag' },
      { tag: 'untagged' },
      { dateFrom: '2025-02-15', dateTo: '2025-02-15' },
      {
        search: 'Travel',
        folder: 'own-folder',
        tag: 'own-tag',
        visibility: 'private',
        types: 'image/png',
      },
    ] as Record<string, string>[]) {
      const summary = await getTimeline(params)
      const page = await getFiles({ ...params, snapshot: summary.snapshot })
      expect(summary.total, JSON.stringify(params)).toBe(page.pagination.total)
      expect(
        summary.buckets.reduce((sum, bucket) => sum + bucket.count, 0)
      ).toBe(page.data.length)
    }
  })

  it('uses one undated bucket for non-date sorts and preserves the snapshot upload ceiling', async () => {
    await file('2025-01-01T00:00:00.000Z')
    const result = await getTimeline({ sortBy: 'name', groupBy: 'week' })
    expect(result.buckets).toEqual([
      { key: 'all', from: null, to: null, count: 1, offset: 0 },
    ])
    expect(result.groupBy).toBe('none')
    await file(
      new Date(new Date(result.snapshot).getTime() + 1000).toISOString()
    )
    expect(
      (await getFiles({ snapshot: result.snapshot })).pagination.total
    ).toBe(1)
    expect((await getFiles({})).pagination.total).toBe(2)
  })

  it('returns empty buckets for an empty result and 400 for invalid input', async () => {
    expect((await getTimeline()).buckets).toEqual([])
    for (const params of [
      { timezone: 'Unknown/Nowhere' },
      { timezone: '+01:00' },
      { groupBy: 'day' },
      { dateFrom: 'not-a-date' },
      { visibility: 'hidden' },
    ] as Record<string, string>[])
      expect((await timeline.GET(request('/timeline', params))).status).toBe(
        400
      )
    expect(
      (await files.GET(request('', { snapshot: 'not-a-date' }))).status
    ).toBe(400)
  })

  it('uses the upload database clock even when the application clock is behind', async () => {
    await prisma.file.create({
      data: {
        name: 'new-upload.png',
        path: 'uploads/new-upload.png',
        urlPath: '/timeline-owner/new-upload.png',
        userId: 'timeline-owner',
        mimeType: 'image/png',
        size: 1,
      },
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'))
    try {
      const result = await getTimeline()
      expect(result.total).toBe(1)
      expect(Date.parse(result.snapshot)).toBeGreaterThan(Date.now())
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains only the earliest active expiration per file in a bounded metadata page', async () => {
    const row = await file('2025-01-01T00:00:00.000Z')
    const earlier = new Date('2030-01-01T00:00:00.000Z')
    await prisma.event.createMany({
      data: [
        {
          type: 'file.expired',
          status: 'PENDING',
          scheduledAt: earlier,
          payload: { fileId: row.id },
        },
        {
          type: 'file.schedule-expiration',
          status: 'SCHEDULED',
          scheduledAt: new Date('2031-01-01T00:00:00.000Z'),
          payload: { fileId: row.id },
        },
        {
          type: 'file.expired',
          status: 'COMPLETED',
          scheduledAt: new Date('2029-01-01T00:00:00.000Z'),
          payload: { fileId: row.id },
        },
      ],
    })
    expect((await getFiles({})).data[0].expiresAt).toBe(earlier.toISOString())
  })
})
