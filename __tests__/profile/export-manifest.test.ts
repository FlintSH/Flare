import { GET } from '@/app/api/profile/export/manifest/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  permissions: ['profile.export', 'files.read', 'links.read'] as string[],
  session: true,
  files: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/http/access', async () => {
  const { AccessError } = await import('@/lib/http/errors')
  const check = (permission: string) => {
    if (!state.permissions.includes(permission))
      throw new AccessError(403, 'Permission denied')
  }
  return {
    requireSession: async (_request: Request, permission?: string) => {
      if (!state.session) throw new AccessError(401, 'Authentication required')
      if (permission) check(permission)
      return { session: { user: { id: 'owner' } }, user: { id: 'owner' } }
    },
    assertPermission: (_user: unknown, permission: string) => check(permission),
  }
})
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: 'owner',
        name: 'Export Owner',
        email: 'owner@example.test',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        files: state.files,
        shortenedUrls: [
          {
            shortCode: 'abc',
            targetUrl: 'https://example.test/',
            clicks: 3,
            createdAt: new Date('2026-02-01T00:00:00Z'),
          },
        ],
      }),
    },
  },
}))
vi.mock('@/lib/storage', () => ({ getStorageProvider: async () => ({}) }))

const plain = {
  id: 'file-plain',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 12345 / 1048576,
  visibility: 'PRIVATE',
  uploadedAt: new Date('2026-10-01T12:00:00Z'),
  isOcrProcessed: false,
  ocrText: null,
  isPaste: false,
  path: 'uploads/alexm/uuid/notes.txt',
  urlPath: '/alexm/notes.txt',
  encrypted: false,
  header: null,
  sealedMetadata: null,
  accountStanza: null,
  stanzaAccountPublicKey: null,
  passwordStanza: null,
}
const secret = {
  ...plain,
  id: 'file-secret',
  name: '',
  mimeType: 'application/octet-stream',
  size: 70026 / 1048576,
  path: 'uploads/alexm/uuid/e_AAAAAAAAAAAAAAAAAAAAAA',
  urlPath: '/alexm/e_AAAAAAAAAAAAAAAAAAAAAA',
  encrypted: true,
  header: new Uint8Array(26).fill(1),
  sealedMetadata: new Uint8Array(80).fill(2),
  accountStanza: new Uint8Array(97).fill(3),
  stanzaAccountPublicKey: new Uint8Array(32).fill(4),
}

const request = () =>
  GET(new Request('https://flare.test/api/profile/export/manifest'))

beforeEach(() => {
  state.permissions = ['profile.export', 'files.read', 'links.read']
  state.session = true
  state.files = [plain, secret]
})

describe('GET /api/profile/export/manifest', () => {
  it('lists each file with its address and its size in bytes, and the account record', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { data } = await response.json()
    expect(data.files).toEqual([
      {
        id: 'file-plain',
        urlPath: '/alexm/notes.txt',
        sizeBytes: 12345,
        uploadedAt: '2026-10-01T12:00:00.000Z',
        encrypted: false,
        name: 'notes.txt',
      },
      {
        id: 'file-secret',
        urlPath: '/alexm/e_AAAAAAAAAAAAAAAAAAAAAA',
        sizeBytes: 70026,
        uploadedAt: '2026-10-01T12:00:00.000Z',
        encrypted: true,
        name: null,
        encryption: {
          header: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
          sealedMetadata: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          accountStanza: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          stanzaAccountPublicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        },
      },
    ])
    // The record is what the server export writes as user-data.json: no
    // file IDs, and the same order as the list.
    expect(data.record).toMatchObject({
      id: 'owner',
      email: 'owner@example.test',
      shortenedUrls: [{ shortCode: 'abc', clicks: 3 }],
    })
    expect(data.record.files).toHaveLength(2)
    expect(data.record.files[0]).toMatchObject({ name: 'notes.txt' })
    expect(data.record.files[0].id).toBeUndefined()
    expect(data.record.files[1]).toMatchObject({
      name: '',
      encrypted: true,
      urlPath: '/alexm/e_AAAAAAAAAAAAAAAAAAAAAA',
    })
    expect(data.record.files[1].id).toBeUndefined()
  })

  it('names no encrypted file and gives no stanza a visitor could not get', async () => {
    const { data } = await (await request()).json()
    expect(data.files[1].name).toBeNull()
    // The password stanza is in the record, as in the server export. The
    // list has only what opens the file with the account key.
    expect(Object.keys(data.files[1].encryption)).toEqual([
      'header',
      'sealedMetadata',
      'accountStanza',
      'stanzaAccountPublicKey',
    ])
  })

  it.each(['profile.export', 'files.read', 'links.read'])(
    'needs %s, like the export itself',
    async (missing) => {
      state.permissions = state.permissions.filter((name) => name !== missing)
      const response = await request()
      expect(response.status).toBe(403)
    }
  )

  it('needs a browser session', async () => {
    state.session = false
    expect((await request()).status).toBe(401)
  })
})
