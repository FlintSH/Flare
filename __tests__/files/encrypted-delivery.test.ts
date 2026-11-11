import { GET as directGET } from '@/app/(raw)/[userUrlId]/[filename]/direct/route'
import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { GET as contentGET } from '@/app/api/files/[...path]/route'
import { GET as downloadGET } from '@/app/api/files/[id]/download/route'
import { GET as recordsGET } from '@/app/api/files/[id]/encryption/route'
import { GET as ocrGET } from '@/app/api/files/[id]/ocr/route'
import { GET as thumbnailGET } from '@/app/api/files/[id]/thumbnail/route'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import {
  accountKeysFromPrivateKey,
  base64urlDecode,
  storedLengthOf,
} from '@/lib/e2ee'
import { newEncryptedFile } from '@/lib/e2ee/client/files'
import type { AccountPrivateKey } from '@/lib/e2ee/types'

const account = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 40) as AccountPrivateKey
)
const created = newEncryptedFile({
  name: 'private-notes.html',
  type: 'text/html',
  accountPublicKey: account.accountPublicKey,
})
const header = Buffer.from(base64urlDecode(created.records.header))
// What storage holds: the header, then bytes that stand in for chunks.
const ciphertext = Buffer.concat([
  header,
  Buffer.alloc(storedLengthOf(100) - 26, 0xa5),
])

const state = vi.hoisted(() => ({
  file: undefined as unknown,
  session: null as unknown,
  provider: undefined as unknown,
  audits: [] as Array<Record<string, unknown>>,
}))
const db = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => state.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: async () => state.file, update: db.update },
    user: { findUnique: async () => null },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))
vi.mock('@/lib/logger', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  return { loggers: new Proxy({}, { get: () => logger }) }
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    name: '',
    urlPath: '/abc12/e_0123456789abcdefghijkl',
    path: 'uploads/abc12/key/e_0123456789abcdefghijkl',
    mimeType: 'application/octet-stream',
    size: ciphertext.length / 1024 ** 2,
    userId: 'owner',
    visibility: 'PUBLIC',
    password: null,
    isOcrProcessed: false,
    ocrText: null,
    ocrConfidence: null,
    ocrTagsPendingAt: null,
    encrypted: true,
    header: new Uint8Array(header),
    sealedMetadata: base64urlDecode(created.records.sealedMetadata),
    accountStanza: base64urlDecode(created.records.accountStanza),
    stanzaAccountPublicKey: account.accountPublicKey,
    passwordStanza: null as Uint8Array | null,
    ...overrides,
  }
}

const provider = () => ({
  getFileSize: vi.fn(async () => ciphertext.length),
  getFileStream: vi.fn(
    async (_path: string, range?: { start: number; end: number }) =>
      Readable.from([
        range ? ciphertext.subarray(range.start, range.end + 1) : ciphertext,
      ])
  ),
  getDownloadUrl: vi.fn(async () => 'https://bucket.example/signed'),
  getPublicUrl: vi.fn(async () => 'https://bucket.example/public'),
})

const sessionOf = (id: string, permissions: string[]) => ({
  user: { id, permissions },
})
const owner = sessionOf('owner', ['files.read'])
const moderator = sessionOf('moderator', ['content.read'])
const stranger = sessionOf('someone', ['files.read'])

const byId = { params: Promise.resolve({ id: 'file-1' }) }
const byPath = {
  params: Promise.resolve({ path: ['abc12', 'e_0123456789abcdefghijkl'] }),
}
const byLink = {
  params: Promise.resolve({
    userUrlId: 'abc12',
    filename: 'e_0123456789abcdefghijkl',
  }),
}
const get = (path: string, init?: RequestInit) =>
  new Request(`https://flare.test${path}`, init)

beforeEach(() => {
  vi.clearAllMocks()
  state.file = row()
  state.session = null
  state.provider = provider()
  state.audits = []
  configureAuditWriter(async (event) => void state.audits.push(event))
  db.update.mockResolvedValue(undefined)
})

describe('serving the ciphertext of an encrypted file', () => {
  it('sends it as a generic attachment in a sandbox, never inline', async () => {
    const response = await contentGET(get('/api/files/abc12/e_x'), byPath)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="encrypted"; filename*=UTF-8''encrypted`
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe(
      String(ciphertext.length)
    )
    expect(Buffer.from(await response.arrayBuffer()).equals(ciphertext)).toBe(
      true
    )
  })

  it('serves byte ranges of the ciphertext, as a chunk reader asks for them', async () => {
    const first = await contentGET(
      get('/api/files/abc12/e_x', { headers: { Range: 'bytes=0-25' } }),
      byPath
    )
    expect(first.status).toBe(206)
    expect(first.headers.get('content-range')).toBe(
      `bytes 0-25/${ciphertext.length}`
    )
    expect(Buffer.from(await first.arrayBuffer()).equals(header)).toBe(true)
    expect(first.headers.get('content-type')).toBe('application/octet-stream')
    expect(first.headers.get('content-disposition')).toMatch(/^attachment/)

    const tail = await contentGET(
      get('/api/files/abc12/e_x', { headers: { Range: 'bytes=26-' } }),
      byPath
    )
    expect(tail.status).toBe(206)
    expect((await tail.arrayBuffer()).byteLength).toBe(ciphertext.length - 26)

    const beyond = await contentGET(
      get('/api/files/abc12/e_x', {
        headers: { Range: `bytes=${ciphertext.length}-` },
      }),
      byPath
    )
    expect(beyond.status).toBe(416)
  })

  it('never redirects a download to a signed storage address', async () => {
    const response = await downloadGET(get('/api/files/file-1/download'), byId)
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(
      (state.provider as ReturnType<typeof provider>).getDownloadUrl
    ).not.toHaveBeenCalled()
    // A plain file on the same storage still gets its redirect.
    state.file = row({
      encrypted: false,
      name: 'a.txt',
      mimeType: 'text/plain',
    })
    const plain = await downloadGET(get('/api/files/file-1/download'), byId)
    expect(plain.status).toBe(302)
  })

  it('answers 404 at /raw and /direct, and names no storage address', async () => {
    const raw = await rawGET(get('/abc12/e_x/raw'), byLink)
    expect(raw.status).toBe(404)
    const direct = await directGET(get('/abc12/e_x/direct'), byLink)
    expect(direct.status).toBe(404)
    expect(await direct.text()).toBe('')
    expect(
      (state.provider as ReturnType<typeof provider>).getPublicUrl
    ).not.toHaveBeenCalled()
  })

  it('has no server thumbnail, and answers the sealed text instead of reading the image', async () => {
    expect(
      (await thumbnailGET(get('/api/files/file-1/thumbnail'), byId)).status
    ).toBe(400)
    // No text was stored: the client that has the file key reads the image.
    const none = await ocrGET(get('/api/files/file-1/ocr'), byId)
    expect(none.status).toBe(200)
    expect(none.headers.get('cache-control')).toBe('private, no-store')
    expect(await none.json()).toEqual({
      success: true,
      encrypted: true,
      sealedOcrText: null,
    })
    // The record of the owner's browser comes back as it is stored.
    const sealedOcrText = new Uint8Array(80).fill(9)
    state.file = row({ sealedData: { sealedOcrText } })
    const stored = await ocrGET(get('/api/files/file-1/ocr'), byId)
    expect(await stored.json()).toEqual({
      success: true,
      encrypted: true,
      sealedOcrText: Buffer.from(sealedOcrText).toString('base64url'),
    })
  })

  it('ignores a ?password= value: the server checks no password for it', async () => {
    state.file = row({ passwordStanza: new Uint8Array(217).fill(1) })
    const response = await contentGET(
      get('/api/files/abc12/e_x?password=anything'),
      byPath
    )
    // The ciphertext of a public file is public. The stanza guards the key.
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('keeps a private file from everyone but its owner and moderators', async () => {
    state.file = row({ visibility: 'PRIVATE' })
    expect((await contentGET(get('/api/files/abc12/e_x'), byPath)).status).toBe(
      404
    )
    state.session = stranger
    expect((await contentGET(get('/api/files/abc12/e_x'), byPath)).status).toBe(
      404
    )
    state.session = owner
    expect((await contentGET(get('/api/files/abc12/e_x'), byPath)).status).toBe(
      200
    )
    state.session = moderator
    const response = await contentGET(get('/api/files/abc12/e_x'), byPath)
    expect(response.status).toBe(200)
    // What a moderator gets is ciphertext.
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 8)
        .toString()
    ).toBe('FLAREE2E')
  })

  it('writes no name into the audit record', async () => {
    await contentGET(get('/api/files/abc12/e_x'), byPath)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0].targetId).toBe('file-1')
    expect(state.audits[0].targetName ?? null).toBeNull()
    expect(JSON.stringify(state.audits)).not.toContain('private-notes')
  })
})

describe('GET /api/files/{id}/encryption', () => {
  const read = async () => {
    const response = await recordsGET(get('/api/files/file-1/encryption'), byId)
    return { status: response.status, body: await response.json(), response }
  }

  it('gives a visitor of a public file the records that the key opens, without the account stanza', async () => {
    const { status, body, response } = await read()
    expect(status).toBe(200)
    expect(body).toEqual({
      id: 'file-1',
      urlPath: '/abc12/e_0123456789abcdefghijkl',
      sizeBytes: ciphertext.length,
      header: created.records.header,
      sealedMetadata: created.records.sealedMetadata,
      passwordStanza: null,
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('adds the account stanza for the owner only', async () => {
    state.session = owner
    expect((await read()).body).toMatchObject({
      accountStanza: created.records.accountStanza,
      stanzaAccountPublicKey: created.records.stanzaAccountPublicKey,
    })
    for (const session of [stranger, moderator]) {
      state.session = session
      const { body } = await read()
      expect(body.accountStanza).toBeUndefined()
      expect(body.stanzaAccountPublicKey).toBeUndefined()
    }
  })

  it('sends the password stanza to anyone who may fetch the file', async () => {
    const stanza = new Uint8Array(217).fill(7)
    stanza[0] = 1
    state.file = row({ passwordStanza: stanza })
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(base64urlDecode(body.passwordStanza)).toEqual(stanza)
  })

  it('hides a private file as a missing one from strangers, and serves the owner and a moderator', async () => {
    state.file = row({ visibility: 'PRIVATE' })
    expect((await read()).status).toBe(404)
    state.session = stranger
    expect((await read()).status).toBe(404)
    state.session = moderator
    const seen = await read()
    expect(seen.status).toBe(200)
    expect(seen.body.accountStanza).toBeUndefined()
    state.session = owner
    expect((await read()).body.accountStanza).toBe(
      created.records.accountStanza
    )
  })

  it('answers 404 for no file and 400 for a plain file', async () => {
    state.file = null
    expect((await read()).status).toBe(404)
    state.file = row({
      encrypted: false,
      header: null,
      sealedMetadata: null,
      accountStanza: null,
      stanzaAccountPublicKey: null,
      name: 'a.txt',
      mimeType: 'text/plain',
    })
    expect((await read()).status).toBe(400)
  })

  it('never includes a name or a type', async () => {
    state.session = owner
    const { body } = await read()
    expect(Object.keys(body).sort()).toEqual([
      'accountStanza',
      'header',
      'id',
      'passwordStanza',
      'sealedMetadata',
      'sizeBytes',
      'stanzaAccountPublicKey',
      'urlPath',
    ])
  })
})
