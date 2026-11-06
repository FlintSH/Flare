import { POST as completeChunks } from '@/app/api/files/chunks/[uploadId]/complete/route'
import {
  PUT as finishChunks,
  POST as startChunks,
} from '@/app/api/files/chunks/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ account: vi.fn() }))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: mocks.account,
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))

let address = 0
const start = (body: unknown) =>
  startChunks(
    new Request('https://flare.test/api/files/chunks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer flr_token',
        'Content-Type': 'application/json',
        // Each request comes from its own address, under the upload limit.
        'x-real-ip': `203.0.113.${++address}`,
      },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  mocks.account.mockResolvedValue({
    id: 'owner',
    permissions: ['administrator'],
    credential: 'token',
  })
})

describe('chunk upload request bodies', () => {
  it('answers fields it does not read with the upload message', async () => {
    for (const body of [
      { filename: 'notes.txt', mimeType: 'text/plain', size: -1 },
      { filename: 'notes.txt', mimeType: 'text/plain', size: 1, extra: true },
    ]) {
      const response = await start(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Invalid upload options.',
      })
    }
    const completion = await completeChunks(
      new Request('https://flare.test/api/files/chunks/upload/complete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer flr_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parts: [] }),
      }),
      { params: Promise.resolve({ uploadId: 'upload' }) }
    )
    expect(completion.status).toBe(400)
    expect(await completion.json()).toEqual({
      error: 'Invalid upload options.',
    })
  })

  it('still ignores the retired copy format', async () => {
    // The body is read; the empty file name is what is refused next.
    const response = await start({
      filename: '..',
      mimeType: 'text/plain',
      size: 1,
      copyFormat: 'markdown',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid filename.' })
  })

  it('asks for the upload ID of a completion body without one, null included', async () => {
    for (const body of [null, [], {}, { uploadId: 5 }]) {
      const response = await finishChunks(
        new Request('https://flare.test/api/files/chunks', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer flr_token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Upload ID is required.',
      })
    }
  })
})
