import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base64urlEncode } from '@/lib/e2ee/primitives'
import {
  type FileAuthority,
  fileSettingsSchema,
  listAccountFiles,
  updateFileSettings,
} from '@/lib/files/manage'

const mocks = vi.hoisted(() => ({
  file: {
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: { file: mocks.file } }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: async () => ({}) }))

const owner: FileAuthority = { as: 'owner', userId: 'owner' }
const moderator: FileAuthority = { as: 'moderator', accountId: 'owner' }
const stanza = new Uint8Array(217).fill(9)
stanza[0] = 1
const stanzaText = base64urlEncode(stanza)
const row = (encrypted: boolean) => ({
  id: 'file-one',
  name: encrypted ? '' : 'notes.txt',
  userId: 'owner',
  path: 'p',
  size: 1,
  encrypted,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.file.update.mockImplementation(async ({ data }) => ({
    id: 'file-one',
    visibility: 'PUBLIC',
    password: null,
    passwordStanza: null,
    ...data,
  }))
})

describe('password of an encrypted file (section 8.2)', () => {
  it('stores the stanza the owner sends, and reports the file as protected', async () => {
    mocks.file.findUnique.mockResolvedValue(row(true))
    const saved = await updateFileSettings(owner, 'file-one', {
      passwordStanza: stanzaText,
    })
    expect(mocks.file.update.mock.calls[0][0].data).toEqual({
      passwordStanza: stanza,
    })
    expect(saved.hasPassword).toBe(true)
    // No record leaves in the answer.
    for (const field of [
      'passwordStanza',
      'header',
      'sealedMetadata',
      'accountStanza',
      'password',
    ])
      expect(field in saved, field).toBe(false)
  })

  it('removes the stanza with null', async () => {
    mocks.file.findUnique.mockResolvedValue(row(true))
    const saved = await updateFileSettings(owner, 'file-one', {
      passwordStanza: null,
    })
    expect(mocks.file.update.mock.calls[0][0].data).toEqual({
      passwordStanza: null,
    })
    expect(saved.hasPassword).toBe(false)
  })

  it('refuses a server password for an encrypted file: the server checks none', async () => {
    mocks.file.findUnique.mockResolvedValue(row(true))
    await expect(
      updateFileSettings(owner, 'file-one', { password: 'a-server-password' })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      updateFileSettings(owner, 'file-one', { password: null })
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.file.update).not.toHaveBeenCalled()
  })

  it('refuses a stanza from a moderator, who can still change visibility', async () => {
    mocks.file.findUnique.mockResolvedValue(row(true))
    await expect(
      updateFileSettings(moderator, 'file-one', { passwordStanza: null })
    ).rejects.toMatchObject({ status: 403 })
    await updateFileSettings(moderator, 'file-one', { visibility: 'PRIVATE' })
    expect(mocks.file.update.mock.calls[0][0].data).toEqual({
      visibility: 'PRIVATE',
    })
  })

  it('refuses a stanza of the wrong length or version, and one for a plain file', async () => {
    mocks.file.findUnique.mockResolvedValue(row(true))
    const short = base64urlEncode(stanza.subarray(0, 216))
    await expect(
      updateFileSettings(owner, 'file-one', { passwordStanza: short })
    ).rejects.toMatchObject({ status: 400 })
    const version = stanza.slice()
    version[0] = 2
    await expect(
      updateFileSettings(owner, 'file-one', {
        passwordStanza: base64urlEncode(version),
      })
    ).rejects.toMatchObject({ status: 400 })
    mocks.file.findUnique.mockResolvedValue(row(false))
    await expect(
      updateFileSettings(owner, 'file-one', { passwordStanza: stanzaText })
    ).rejects.toMatchObject({ status: 400 })
    expect(
      fileSettingsSchema.safeParse({ passwordStanza: 'not base64url!' }).success
    ).toBe(false)
  })

  it('still hashes a server password for a plain file', async () => {
    mocks.file.findUnique.mockResolvedValue(row(false))
    await updateFileSettings(owner, 'file-one', {
      password: 'plain-file-password',
    })
    expect(mocks.file.update.mock.calls[0][0].data.password).toMatch(/^\$2/)
  })
})

describe('a moderator’s list of an account’s files', () => {
  it('marks encrypted files, shows a password stanza as protected, and has no records', async () => {
    mocks.file.count.mockResolvedValue(2)
    mocks.file.findMany.mockResolvedValue([
      {
        id: 'a',
        name: '',
        mimeType: 'application/octet-stream',
        size: 1,
        visibility: 'PUBLIC',
        uploadedAt: new Date(0),
        urlPath: '/owner/e_0123456789abcdefghijkl',
        isPaste: false,
        password: null,
        encrypted: true,
        passwordStanza: stanza,
      },
      {
        id: 'b',
        name: '',
        mimeType: 'application/octet-stream',
        size: 1,
        visibility: 'PRIVATE',
        uploadedAt: new Date(0),
        urlPath: '/owner/e_abcdefghijkl0123456789',
        isPaste: false,
        password: null,
        encrypted: true,
        passwordStanza: null,
      },
    ])
    const { files } = await listAccountFiles('owner', {
      page: 1,
      limit: 10,
      search: '',
      visibility: '',
      type: '',
    })
    expect(
      files.map((file) => [file.encrypted, file.visibility, file.name])
    ).toEqual([
      [true, 'PROTECTED', ''],
      [true, 'PRIVATE', ''],
    ])
    expect(JSON.stringify(files)).not.toContain('passwordStanza')
  })
})
