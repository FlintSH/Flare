import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { POST as downloadPOST } from '@/app/api/files/[id]/download/route'
import { GET as ocrGET } from '@/app/api/files/[id]/ocr/route'
import { GET as thumbnailGET } from '@/app/api/files/[id]/thumbnail/route'
import { hashSync } from 'bcryptjs'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { FILE_PASSWORD_ATTEMPTS } from '@/lib/files/password-attempts'

const mocks = vi.hoisted(() => ({
  file: null as Record<string, unknown> | null,
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async () => mocks.file,
      update: mocks.update,
    },
  },
}))
vi.mock('@/lib/files/resolve', () => ({
  resolveFileUrlPath: async () => mocks.file?.urlPath ?? null,
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileSize: async () => 4,
    getFileStream: async () => Readable.from([Buffer.from('test')]),
    getDownloadUrl: async () => null,
  }),
}))

const password = 'route-password-2026'
const passwordHash = hashSync(password, 4)
let sequence = 0

function protectedFile(mimeType = 'image/png') {
  const id = `route-limit-${++sequence}`
  mocks.file = {
    id,
    name: `${id}.png`,
    path: `uploads/owner/${id}.png`,
    urlPath: `/owner/${id}.png`,
    userId: 'owner',
    visibility: 'PUBLIC',
    password: passwordHash,
    mimeType,
    isOcrProcessed: true,
    ocrText: 'cached text',
    ocrConfidence: 90,
    ocrTagsPendingAt: null,
  }
  return id
}

const address = { 'x-real-ip': '203.0.113.50' }

function raw(guess: string) {
  const file = mocks.file as { urlPath: string }
  const [, userUrlId, filename] = file.urlPath.split('/')
  return rawGET(
    new Request(
      `https://flare.test${file.urlPath}/raw?${new URLSearchParams({ password: guess })}`,
      { headers: address }
    ),
    { params: Promise.resolve({ userUrlId, filename }) }
  )
}

async function exhaust() {
  for (
    let attempt = 1;
    attempt <= FILE_PASSWORD_ATTEMPTS.perRequester;
    attempt++
  )
    expect((await raw(`wrong-${attempt}`)).status).toBe(401)
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.update.mockReset()
})

describe('paused file password checks over HTTP', () => {
  it('returns 429 with Retry-After from the raw route and counts no view', async () => {
    protectedFile()
    await exhaust()

    const response = await raw(password)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(14 * 60)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('keeps thumbnails private while telling the client when to retry', async () => {
    const id = protectedFile()
    await exhaust()

    const response = await thumbnailGET(
      new Request(
        `https://flare.test/api/files/${id}/thumbnail?password=${password}`,
        { headers: address }
      ),
      { params: Promise.resolve({ id }) }
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('applies to passwords sent in a download request body', async () => {
    const id = protectedFile('text/plain')
    await exhaust()

    const response = await downloadPOST(
      new Request(`https://flare.test/api/files/${id}/download`, {
        method: 'POST',
        headers: { ...address, 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('explains the pause in OCR responses', async () => {
    const id = protectedFile()
    await exhaust()

    const response = await ocrGET(
      new Request(
        `https://flare.test/api/files/${id}/ocr?password=${password}`,
        { headers: address }
      ),
      { params: Promise.resolve({ id }) }
    )
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('Too many incorrect passwords'),
    })
  })

  it('still serves other addresses that know the password', async () => {
    protectedFile()
    await exhaust()

    const file = mocks.file as { urlPath: string }
    const [, userUrlId, filename] = file.urlPath.split('/')
    const response = await rawGET(
      new Request(
        `https://flare.test${file.urlPath}/raw?password=${password}`,
        {
          headers: { 'x-real-ip': '198.51.100.61' },
        }
      ),
      { params: Promise.resolve({ userUrlId, filename }) }
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
  })
})
