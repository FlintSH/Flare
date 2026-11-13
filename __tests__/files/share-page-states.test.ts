import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { hashSync } from 'bcryptjs'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  file: undefined as unknown,
  session: null as null | {
    user: { id: string; name: string; permissions: string[] }
  },
  browser: { data: null as unknown, status: 'unauthenticated' },
}))

const password = 'share-page-states-1'
const image = {
  id: 'share-page-states-image',
  name: 'photo.png',
  urlPath: '/owner/photo.png',
  visibility: 'PUBLIC',
  password: null as string | null,
  userId: 'owner',
  mimeType: 'image/png',
  size: 1,
  path: 'uploads/owner/photo.png',
  uploadOptions: null,
  folderId: null,
  user: { name: 'Owner', image: null },
}
const owner = {
  user: { id: 'owner', name: 'Owner', permissions: ['files.read'] },
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.93' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next-auth/react', () => ({ useSession: () => mocks.browser }))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async () => mocks.file,
      update: async () => mocks.file,
    },
    user: { findUnique: async () => null },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          brand: { name: 'Flare' },
          sharing: { showFooter: false, showFilename: true },
        },
      },
      general: { credits: { showFooter: false } },
    },
  }),
}))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => null,
}))
vi.mock('@/components/layout/dynamic-background', () => ({
  DynamicBackground: () => null,
}))

/**
 * The page as the server sends it. Each viewer's code is loaded on demand, so
 * the render waits for it, as a streamed response does.
 */
async function render(guess?: string) {
  const stream = await renderToReadableStream(
    await FilePage({
      params: Promise.resolve({ userUrlId: 'owner', filename: 'photo.png' }),
      searchParams: Promise.resolve(
        guess === undefined ? {} : { password: guess }
      ),
    })
  )
  await stream.allReady
  return new Response(stream).text()
}

const viewer = (html: string) => html.includes('Loading image…')

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.file = image
  mocks.session = null
  mocks.browser = { data: null, status: 'unauthenticated' }
})

describe('share page states', () => {
  it('shows a public file to anyone', async () => {
    const html = await render()
    expect(viewer(html)).toBe(true)
    expect(html).toContain('aria-label="File actions"')
    expect(html).not.toContain('Checking access…')
    expect(html).not.toContain('This file is private')
  })

  it('answers not found for a private file the visitor may not see', async () => {
    mocks.file = { ...image, visibility: 'PRIVATE' }
    await expect(render()).rejects.toThrow('NOT_FOUND')
  })

  it('answers not found for a missing file', async () => {
    mocks.file = null
    await expect(render()).rejects.toThrow('NOT_FOUND')
  })

  it('waits for the session before showing a private file to its owner', async () => {
    mocks.file = { ...image, visibility: 'PRIVATE' }
    mocks.session = owner
    mocks.browser = { data: null, status: 'loading' }
    const html = await render()
    expect(html).toContain('Checking access…')
    expect(viewer(html)).toBe(false)

    mocks.browser = { data: owner, status: 'authenticated' }
    expect(viewer(await render())).toBe(true)
  })

  it('asks for the password, then shows the file without asking again', async () => {
    mocks.file = { ...image, password: hashSync(password, 4) }
    const prompt = await render()
    expect(prompt).toContain('Password-protected file')
    expect(viewer(prompt)).toBe(false)

    const wrong = await render('not-the-password')
    expect(wrong).toContain('That password didn’t match.')
    expect(viewer(wrong)).toBe(false)

    const html = await render(password)
    expect(viewer(html)).toBe(true)
    expect(html).not.toContain('Password-protected file')
    expect(html).not.toContain('That password didn’t match.')
  })

  it('shows a protected file to its owner without the password', async () => {
    mocks.file = { ...image, password: hashSync(password, 4) }
    mocks.session = owner
    mocks.browser = { data: owner, status: 'authenticated' }
    const html = await render()
    expect(viewer(html)).toBe(true)
    expect(html).not.toContain('Password-protected file')
  })
})
