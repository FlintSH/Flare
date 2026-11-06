import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  viewerFile: null as null | Record<string, unknown>,
  showFilename: false,
}))

const file = {
  id: 'share-page-paste',
  name: 'csv_to_json.py',
  urlPath: '/owner/csv_to_json.py',
  visibility: 'PUBLIC',
  password: null,
  userId: 'owner',
  mimeType: 'text/plain',
  size: 897,
  uploadedAt: new Date('2026-10-01T00:00:00Z'),
  path: 'uploads/owner/csv_to_json.py',
  uploadOptions: null,
  folderId: null,
  user: { name: 'Owner', image: null, urlId: 'owner' },
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.91' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: async () => file, update: async () => file } },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          brand: { name: 'Flare' },
          sharing: { showFooter: false, showFilename: mocks.showFilename },
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
vi.mock('@/components/file/protected-file', () => ({
  ProtectedFile: ({ file }: { file: Record<string, unknown> }) => {
    mocks.viewerFile = file
    return null
  },
}))

function open() {
  return FilePage({
    params: Promise.resolve({
      userUrlId: 'owner',
      filename: 'csv_to_json.py',
    }),
    searchParams: Promise.resolve({}),
  })
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.viewerFile = null
})

describe('share page text highlighting', () => {
  it('names the language from the real filename when filenames are hidden', async () => {
    mocks.showFilename = false
    const html = renderToStaticMarkup(await open())

    expect(mocks.viewerFile).toMatchObject({
      name: 'Shared file',
      textLanguage: 'python',
    })
    expect(html).not.toContain('csv_to_json')
  })

  it('names the language from the shown filename too', async () => {
    mocks.showFilename = true
    renderToStaticMarkup(await open())

    expect(mocks.viewerFile).toMatchObject({
      name: 'csv_to_json.py',
      textLanguage: 'python',
    })
  })
})
