import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { hashSync } from 'bcryptjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

/**
 * What the share page hands its client components is serialized into the
 * page for every visitor, whatever the markup shows. Rendering to markup
 * alone can't see that, so these tests read the props themselves.
 */
const mocks = vi.hoisted(() => ({
  file: undefined as unknown,
  session: null as unknown,
  sharing: {} as Record<string, unknown>,
  actions: [] as Record<string, unknown>[],
  viewer: [] as Record<string, unknown>[],
}))

const password = 'client-props-1'
const stored = {
  id: 'share-page-client-props',
  name: 'Quarterly budget.csv',
  urlPath: '/owner/q3.csv',
  visibility: 'PUBLIC',
  password: hashSync(password, 4),
  userId: 'owner-account-id',
  mimeType: 'text/csv',
  size: 1.5,
  path: 'uploads/owner/storage-key/q3.csv',
  uploadOptions: { expiresAt: null, profileId: 'private-profile-id' },
  folderId: 'private-folder-id',
  user: { name: 'Private Person', image: '/api/avatars/private.jpg' },
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.95' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
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
vi.mock('@/components/file/file-actions', () => ({
  FileActions: (props: Record<string, unknown>) => {
    mocks.actions.push(props)
    return null
  },
}))
vi.mock('@/components/file/protected-file', () => ({
  ProtectedFile: (props: Record<string, unknown>) => {
    mocks.viewer.push(props)
    return null
  },
}))

async function open() {
  mocks.file = stored
  renderToStaticMarkup(
    await FilePage({
      params: Promise.resolve({ userUrlId: 'owner', filename: 'q3.csv' }),
      searchParams: Promise.resolve({ password }),
    })
  )
  expect(mocks.actions).toHaveLength(1)
  expect(mocks.viewer).toHaveLength(1)
  return { actions: mocks.actions[0], viewer: mocks.viewer[0] }
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.sharing = {}
  mocks.actions = []
  mocks.viewer = []
})

describe('what the share page sends to the browser', () => {
  it('sends the viewer fields and nothing else about the file', async () => {
    const { actions, viewer } = await open()
    const file = {
      id: stored.id,
      name: stored.name,
      urlPath: stored.urlPath,
      visibility: 'PUBLIC',
      mimeType: 'text/csv',
      size: 1572864,
      kind: 'csv',
    }
    expect(viewer).toEqual({ file, verifiedPassword: password })
    expect(actions).toEqual({
      file,
      verifiedPassword: password,
      showOcr: false,
      isTextBased: true,
      layout: 'toolbar',
    })
    // Never the stored password hash, the owner, the storage key, the
    // folder, the upload profile or the uploader's profile.
    const sent = JSON.stringify([actions, viewer])
    for (const secret of [
      stored.password,
      stored.userId,
      'storage-key',
      stored.folderId,
      'private-profile-id',
      'Private Person',
      'private.jpg',
    ])
      expect(sent, secret).not.toContain(secret)
  })

  // The name is still in the file's address, which the page can't hide.
  it('sends a stand-in for a hidden filename', async () => {
    mocks.sharing = { showFilename: false }
    const { actions, viewer } = await open()
    for (const props of [actions, viewer])
      expect(props.file).toMatchObject({ name: 'Shared file', kind: 'csv' })
    expect(JSON.stringify([actions, viewer])).not.toContain('Quarterly')
  })

  it('leaves out the size when sizes are hidden', async () => {
    mocks.sharing = { showSize: false }
    const { actions, viewer } = await open()
    for (const props of [actions, viewer])
      expect(props.file).not.toHaveProperty('size')
  })

  it('tells the viewer a tab-separated file’s delimiter', async () => {
    mocks.file = undefined
    Object.assign(stored, { name: 'cities.tsv', urlPath: '/owner/cities.tsv' })
    const { viewer } = await open()
    expect(viewer.file).toMatchObject({ kind: 'csv', delimiter: '\t' })
    Object.assign(stored, {
      name: 'Quarterly budget.csv',
      urlPath: '/owner/q3.csv',
    })
  })
})
