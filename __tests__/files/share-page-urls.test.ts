import FilePage, {
  generateMetadata,
} from '@/app/(main)/[userUrlId]/[filename]/page'
import { hashSync } from 'bcryptjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({ file: undefined as unknown }))

const file = {
  id: 'share-page-urls-file',
  name: 'photo.png',
  urlPath: '/owner/photo.png',
  visibility: 'PUBLIC',
  password: null as string | null,
  userId: 'owner',
  mimeType: 'image/png',
  size: 1,
  path: 'uploads/owner/key/photo.png',
  uploadOptions: null,
  folderId: null,
  user: { name: 'Owner', image: null },
}

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'share.example', 'x-real-ip': '203.0.113.92' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async () => mocks.file,
      update: async () => mocks.file,
    },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getPublicUrl: async () => null }),
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          brand: { name: 'Flare', tagline: 'Files' },
          sharing: {
            showFooter: false,
            showFilename: true,
            showSize: true,
            showUploader: true,
            titleTemplate: '',
            descriptionTemplate: '',
          },
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

const page = (filename: string, password?: string) => ({
  params: Promise.resolve({ userUrlId: 'owner', filename }),
  searchParams: Promise.resolve(password === undefined ? {} : { password }),
})

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.file = file
})

describe('share page addresses', () => {
  it('points social previews at the raw file on the requested host', async () => {
    const metadata = await generateMetadata(page('photo.png'))
    const raw = 'http://share.example/owner/photo.png/raw'
    expect(metadata.openGraph).toMatchObject({
      url: raw,
      images: [expect.objectContaining({ url: raw })],
    })
    expect(metadata.twitter).toMatchObject({ images: [raw] })
  })

  it('encodes a name from an earlier build so previews reach the file', async () => {
    // Unencoded, the preview URL ended at the `#` and lost its `/raw`.
    mocks.file = { ...file, urlPath: '/owner/notes #1.png' }
    const metadata = await generateMetadata(page('notes #1.png'))
    const raw = 'http://share.example/owner/notes%20%231.png/raw'
    expect(metadata.openGraph).toMatchObject({
      url: raw,
      images: [expect.objectContaining({ url: raw })],
    })
    expect(metadata.twitter).toMatchObject({ images: [raw] })
  })

  it('plays a video from its raw URL when storage has no direct link', async () => {
    mocks.file = {
      ...file,
      name: 'clip.webm',
      urlPath: '/owner/clip 50%.webm',
      mimeType: 'video/webm',
    }
    const metadata = await generateMetadata(page('clip 50%.webm'))
    const raw = 'http://share.example/owner/clip%2050%25.webm/raw'
    expect(metadata.openGraph).toMatchObject({
      url: raw,
      videos: [expect.objectContaining({ url: raw, secureUrl: raw })],
    })
  })

  it('submits the password form to the file page, encoded', async () => {
    mocks.file = {
      ...file,
      id: 'share-page-urls-protected',
      urlPath: '/owner/what?-1.png',
      password: hashSync('correct horse', 4),
    }
    const html = renderToStaticMarkup(await FilePage(page('what?-1.png')))
    expect(html).toContain('action="/owner/what%3F-1.png"')
  })
})
