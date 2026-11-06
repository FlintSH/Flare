import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { hashSync } from 'bcryptjs'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { FILE_PASSWORD_ATTEMPTS } from '@/lib/files/password-attempts'

const mocks = vi.hoisted(() => ({
  file: null as { urlPath: string } | null,
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: async () => mocks.file, update: async () => ({}) },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileSize: async () => 4,
    getFileStream: async () => Readable.from([Buffer.from('test')]),
    getDownloadUrl: async () => null,
  }),
}))

const password = 'no-address-password-2026'
const passwordHash = hashSync(password, 4)
let sequence = 0

function protectedFile() {
  const id = `no-address-${++sequence}`
  mocks.file = {
    id,
    name: `${id}.png`,
    path: `uploads/owner/${id}.png`,
    urlPath: `/owner/${id}.png`,
    userId: 'owner',
    visibility: 'PUBLIC',
    password: passwordHash,
    mimeType: 'image/png',
  } as { urlPath: string }
}

function raw(guess: string, headers: Record<string, string>) {
  const [, userUrlId, filename] = mocks.file!.urlPath.split('/')
  return rawGET(
    new Request(
      `https://flare.test${mocks.file!.urlPath}/raw?${new URLSearchParams({ password: guess })}`,
      { headers }
    ),
    { params: Promise.resolve({ userUrlId, filename }) }
  )
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
})

describe('file password checks without a client address', () => {
  it.each<Record<string, string>>([{}, { 'x-real-ip': 'unknown' }])(
    'count only toward the whole-file limit (%o)',
    async (headers) => {
      protectedFile()
      for (
        let attempt = 1;
        attempt <= FILE_PASSWORD_ATTEMPTS.perRequester * 2;
        attempt++
      )
        expect((await raw(`wrong-${attempt}`, headers)).status).toBe(401)
      expect((await raw(password, headers)).status).toBe(200)
    }
  )
})
