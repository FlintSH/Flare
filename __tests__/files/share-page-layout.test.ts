import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  file: undefined as unknown,
  sharing: {} as Record<string, unknown>,
}))

const image = {
  id: 'share-page-layout-image',
  name: 'Lisbon rooftops.png',
  urlPath: '/owner/lisbon-rooftops.png',
  visibility: 'PUBLIC',
  password: null,
  userId: 'owner',
  mimeType: 'image/png',
  // Megabytes, as stored.
  size: 1.5,
  path: 'uploads/owner/lisbon-rooftops.png',
  uploadOptions: null as null | Record<string, unknown>,
  folderId: null,
  user: { name: 'Alex Rivera', image: null },
}
const audio = {
  ...image,
  id: 'share-page-layout-audio',
  name: 'Chime.mp3',
  urlPath: '/owner/chime.mp3',
  mimeType: 'audio/mpeg',
}
const binary = {
  ...image,
  id: 'share-page-layout-binary',
  name: 'firmware.bin',
  urlPath: '/owner/firmware.bin',
  mimeType: 'application/octet-stream',
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.94' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
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
          sharing: {
            defaultStyle: 'framed',
            showFooter: false,
            showFilename: true,
            showSize: true,
            showUploader: true,
            ...mocks.sharing,
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

async function render(file: typeof image) {
  mocks.file = file
  return renderToStaticMarkup(
    await FilePage({
      params: Promise.resolve({
        userUrlId: 'owner',
        filename: file.urlPath.split('/').pop()!,
      }),
      searchParams: Promise.resolve({}),
    })
  )
}

/** The page's one heading, as text. */
const heading = (html: string) =>
  /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1].replace(/<[^>]+>/g, '')

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.sharing = {}
})

describe('share page layout', () => {
  it('heads a file with its name, type and size, and its actions', async () => {
    const html = await render(image)
    expect(heading(html)).toBe('Lisbon rooftops.png')
    expect(html).toContain('PNG image')
    expect(html).toContain('1.50 MB')
    expect(html).toContain('Uploaded by')
    expect(html).toContain('Alex Rivera')
    // The header comes before the preview, so the actions are in reach
    // however tall the file is.
    expect(html.indexOf('aria-label="File actions"')).toBeLessThan(
      html.indexOf('Loading image…')
    )
    for (const action of [
      'Download',
      'Copy link',
      'Extract text',
      'Open original',
    ])
      expect(html).toContain(action)
    expect(html).not.toContain('Copy text')
  })

  it('titles a file by its type when filenames are hidden', async () => {
    mocks.sharing = { showFilename: false }
    const html = await render(image)
    expect(heading(html)).toBe('PNG image')
    expect(html).toContain('1.50 MB')
    expect(html).not.toContain('Lisbon')
    expect(html).not.toContain('lisbon')
  })

  it('leaves out the details an instance hides', async () => {
    mocks.sharing = {
      showFilename: false,
      showSize: false,
      showUploader: false,
    }
    const html = await render(image)
    expect(heading(html)).toBe('PNG image')
    expect(html).not.toContain('1.50 MB')
    expect(html).not.toContain('Uploaded by')
    expect(html).not.toContain('Alex Rivera')
  })

  it('says when a file expires, until it has', async () => {
    const soon = new Date(Date.now() + 5 * 3600_000 + 60_000)
    const html = await render({
      ...image,
      uploadOptions: { expiresAt: soon.toISOString() },
    })
    expect(html).toContain('Expires in 5 hours')
    expect(html).toContain(`dateTime="${soon.toISOString()}"`)

    const past = await render({
      ...image,
      uploadOptions: { expiresAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(past).not.toContain('Expires')
    expect(await render(image)).not.toContain('Expires')
  })

  it('gives a file without a preview a small card with named actions', async () => {
    const html = await render(binary)
    expect(heading(html)).toBe('firmware.bin')
    expect(html).toContain('BIN file')
    expect(html).toContain('This file type can’t be previewed here.')
    // Stacked under the name, where every action keeps its label.
    expect(html).not.toContain('sr-only lg:not-sr-only')
    expect(html).toContain('aria-label="File actions"')
  })

  it('shows an audio player from the start, so loading never resizes it', async () => {
    const html = await render(audio)
    expect(html).toContain('MP3 audio')
    expect(html).toContain('<audio')
    expect(html).toContain('aria-label="Chime.mp3 audio player"')
    expect(html).not.toContain('Loading')
  })

  it('names an archive Flare can’t browse and still offers it', async () => {
    const html = await render({
      ...binary,
      name: 'footage.rar',
      urlPath: '/owner/footage.rar',
      mimeType: 'application/vnd.rar',
    })
    expect(html).toContain('RAR archive')
    expect(html).toContain('Download')
    expect(html).toContain('this one to open it on your device')
  })

  it('opens text stored under a generic type, with its text to copy', async () => {
    const html = await render({
      ...binary,
      name: 'README.md',
      urlPath: '/owner/README.md',
    })
    expect(html).toContain('Markdown')
    expect(html).toContain('Copy text')
    expect(html).not.toContain('can’t be previewed')
  })

  it('keeps each style’s own framing', async () => {
    const framed = await render(image)
    expect(framed).toContain('data-share-style="framed"')
    expect(framed).not.toContain('A file for you')

    mocks.sharing = { defaultStyle: 'delivery' }
    const delivery = await render(image)
    expect(delivery).toContain('data-share-style="delivery"')
    expect(delivery).toContain('A file for you')
    expect(delivery).toContain('Alex Rivera')

    // A file's own style, chosen by its upload profile, wins.
    const minimal = await render({
      ...image,
      uploadOptions: { shareStyle: 'minimal' },
    })
    expect(minimal).toContain('data-share-style="minimal"')
    expect(minimal).not.toContain('A file for you')
  })
})
