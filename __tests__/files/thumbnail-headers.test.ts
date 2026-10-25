import { GET } from '@/app/api/files/[id]/thumbnail/route'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

type FixtureFile = {
  id: string
  name: string
  mimeType: string
  path: string
  visibility: 'PUBLIC' | 'PRIVATE'
  userId: string
  password: string | null
}

const state = vi.hoisted(() => ({
  file: null as FixtureFile | null,
  session: null as {
    user: { id: string; permissions: string[] }
  } | null,
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => state.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: async () => state.file } },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileStream: async () =>
      Readable.from([
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>'
        ),
      ]),
  }),
}))

const svg: FixtureFile = {
  id: 'svg-fixture',
  name: 'drawing.svg',
  mimeType: 'image/svg+xml',
  path: 'uploads/owner/svg-fixture/drawing.svg',
  visibility: 'PUBLIC',
  userId: 'owner',
  password: null,
}

async function thumbnail() {
  return GET(
    new Request('https://flare.test/api/files/svg-fixture/thumbnail'),
    {
      params: Promise.resolve({ id: 'svg-fixture' }),
    }
  )
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  state.file = { ...svg }
  state.session = null
})

describe('thumbnail response headers', () => {
  it('sandboxes an SVG so a direct visit cannot run its script', async () => {
    const response = await thumbnail()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // The bytes are still served unchanged for <img> previews.
    expect(await response.text()).toContain('<svg')
  })

  it('sandboxes every stored image type, including XML-based ones', async () => {
    for (const mimeType of ['image/png', 'image/x-drawing+xml', 'image/gif']) {
      state.file = { ...svg, mimeType }
      const response = await thumbnail()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toBe('sandbox')
    }
  })

  it('keeps the policy on protected previews served to their owner', async () => {
    state.file = { ...svg, visibility: 'PRIVATE', password: 'hash' }
    state.session = { user: { id: 'owner', permissions: ['files.read'] } }

    const response = await thumbnail()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
