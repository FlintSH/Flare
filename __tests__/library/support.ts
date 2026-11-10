import type { PrismaClient } from '@prisma/client'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { base64urlDecode, storedLengthOf } from '@/lib/e2ee'
import {
  type NewEncryptedFile,
  createAccountUnwrapper,
  newEncryptedFile,
  newPasswordStanza,
} from '@/lib/e2ee/client/files'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import type { Argon2id } from '@/lib/e2ee/kdf'
import { parseEncryptedRecords } from '@/lib/files/encrypted'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import type { StorageProvider } from '@/lib/storage'
import { mergeUploadOptions } from '@/lib/uploads/schema'

import { clientKeys } from '../auth/e2ee-test-keys'

/** Only the disposable library databases: these suites delete every user. */
export function libraryTestDatabaseUrl(value: string): URL {
  const url = new URL(value)
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/flare_library_test_(local|ci)$/.test(url.pathname) ||
    [...url.searchParams.keys()].length > 0
  )
    throw new Error(
      'Use the disposable local flare_library_test_local or flare_library_test_ci database'
    )
  return url
}

/** A password stanza costs one Argon2id. A test replaces it with a hash that is cheap. */
export const cheapArgon2id: Argon2id = async ({ password: secret, salt }) => {
  const out = new Uint8Array(32)
  for (let index = 0; index < 32; index++)
    out[index] =
      (secret[index % secret.length] ?? 0) ^ salt[index % salt.length]
  return out
}

export type TestKeys = ReturnType<typeof clientKeys>

export function storedKeys(userId: string, keys: TestKeys): StoredAccountKeys {
  return {
    userId,
    accountPublicKey: keys.accountKeys.accountPublicKey,
    accountPrivateKey: keys.accountKeys.accountPrivateKey,
    oldPrivateKeys: [],
  }
}

export async function createUser(
  prisma: PrismaClient,
  keys: TestKeys | null,
  id: string = randomUUID()
) {
  return prisma.user.create({
    data: {
      id,
      name: id,
      urlId: id,
      uploadToken: randomUUID(),
      email: `${id}@example.com`,
      ...(keys?.columns ?? {}),
    },
  })
}

export function sessionUser(id: string): AuthenticatedUser {
  return {
    id,
    storageUsed: 0,
    urlId: id,
    vanityId: null,
    roles: [],
    permissions: [...DEFAULT_PERMISSIONS],
    randomizeFileUrls: false,
    credential: 'session',
  }
}

/** A new encrypted file as a browser makes it, with what an upload carries. */
export function encryptedFile(
  keys: TestKeys,
  name = 'holiday photo.png',
  type = 'image/png'
) {
  return newEncryptedFile({
    name,
    type,
    accountPublicKey: keys.accountKeys.accountPublicKey,
  })
}

/** The row of an encrypted file, stored without an upload. */
export async function insertEncryptedFile(
  prisma: PrismaClient,
  userId: string,
  created: NewEncryptedFile,
  data: Record<string, unknown> = {}
) {
  const records = parseEncryptedRecords(created.records)
  return prisma.file.create({
    data: {
      userId,
      name: '',
      mimeType: 'application/octet-stream',
      urlPath: `/${userId}/e_${randomBytes(16).toString('base64url')}`,
      path: `uploads/${randomUUID()}`,
      size: 0.01,
      encrypted: true,
      header: records.header,
      sealedMetadata: records.sealedMetadata,
      accountStanza: records.accountStanza,
      stanzaAccountPublicKey: records.stanzaAccountPublicKey,
      ...data,
    },
  })
}

/** What `finalizeUpload` takes for an encrypted file whose bytes a fake storage holds. */
export function encryptedUploadInput(
  user: AuthenticatedUser,
  created: NewEncryptedFile,
  extra: Record<string, string> = {},
  options: Parameters<typeof mergeUploadOptions>[2] = {}
) {
  const header = Buffer.from(base64urlDecode(created.records.header))
  const size = storedLengthOf(1000)
  const body = Buffer.concat([header, Buffer.alloc(size - 26, 0x5a)])
  const fileId = `e_${randomBytes(16).toString('base64url')}`
  return {
    user,
    storage: {
      kind: 'local',
      target: { provider: 'local' },
      getFileStream: async () => Readable.from([body.subarray(0, 4100)]),
    } as unknown as StorageProvider,
    filePath: `uploads/${user.urlId}/${randomUUID()}/${fileId}`,
    urlPath: `/${user.urlId}/${fileId}`,
    displayName: '',
    mimeType: 'application/octet-stream',
    size,
    options: mergeUploadOptions({}, {}, options),
    encrypted: parseEncryptedRecords({ ...created.records, ...extra }),
  }
}

export async function passwordStanzaFor(
  keys: TestKeys,
  created: NewEncryptedFile
) {
  return newPasswordStanza({
    opened: created,
    password: 'correct horse battery staple',
    ownerPublicKey: keys.accountKeys.accountPublicKey,
    argon2id: cheapArgon2id,
  })
}

export function unwrapperOf(stored: StoredAccountKeys) {
  return createAccountUnwrapper(stored, { useNative: false })
}
