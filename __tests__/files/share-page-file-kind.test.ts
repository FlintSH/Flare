import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  viewerFile: null as null | Record<string, unknown>,
  showFilename: false,
  file: undefined as unknown,
}))

const paste = {
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
  prisma: {
    file: {
      findUnique: async () => mocks.file,
      update: async () => mocks.file,
    },
  },
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

function open(file: typeof paste) {
  mocks.file = file
  return FilePage({
    params: Promise.resolve({
      userUrlId: 'owner',
      filename: file.urlPath.split('/').pop()!,
    }),
    searchParams: Promise.resolve({}),
  })
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.viewerFile = null
})

describe('share page file kind', () => {
  it('names the language from the real filename when filenames are hidden', async () => {
    mocks.showFilename = false
    const html = renderToStaticMarkup(await open(paste))

    expect(mocks.viewerFile).toMatchObject({
      name: 'Shared file',
      kind: 'text',
      language: 'python',
    })
    expect(html).not.toContain('csv_to_json')
  })

  it('names the language from the shown filename too', async () => {
    mocks.showFilename = true
    renderToStaticMarkup(await open(paste))

    expect(mocks.viewerFile).toMatchObject({
      name: 'csv_to_json.py',
      kind: 'text',
      language: 'python',
    })
  })

  // The viewer used to look for ".csv" in the name it was given, which is
  // "Shared file" when filenames are hidden.
  it('shows a CSV stored under a spreadsheet type as a table when filenames are hidden', async () => {
    mocks.showFilename = false
    renderToStaticMarkup(
      await open({
        ...paste,
        id: 'share-page-csv',
        name: 'Quarterly report.csv',
        urlPath: '/owner/Quarterly-report.csv',
        mimeType: 'application/vnd.ms-excel',
      })
    )

    expect(mocks.viewerFile).toMatchObject({
      name: 'Shared file',
      kind: 'csv',
    })
  })

  it('recognizes a RAR archive by its real name when filenames are hidden', async () => {
    mocks.showFilename = false
    renderToStaticMarkup(
      await open({
        ...paste,
        id: 'share-page-rar',
        name: 'backup.rar',
        urlPath: '/owner/backup.rar',
        mimeType: 'application/octet-stream',
      })
    )

    expect(mocks.viewerFile).toMatchObject({
      name: 'Shared file',
      kind: 'unsupported-archive',
    })
  })

  it('sends the archive format the browser reads', async () => {
    mocks.showFilename = false
    renderToStaticMarkup(
      await open({
        ...paste,
        id: 'share-page-tgz',
        name: 'site.tgz',
        urlPath: '/owner/site.tgz',
        mimeType: 'application/octet-stream',
      })
    )

    expect(mocks.viewerFile).toMatchObject({
      kind: 'archive',
      archiveFormat: 'tar.gz',
    })
  })
})
