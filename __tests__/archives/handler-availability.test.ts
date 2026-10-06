import { POST as extractArchive } from '@/app/api/files/[id]/archive/extract/route'
import { GET as listArchive } from '@/app/api/files/[id]/archive/route'
import { POST as downloadSharedEntry } from '@/app/api/files/[id]/archive/share/entry/route'
import { POST as listSharedArchive } from '@/app/api/files/[id]/archive/share/route'
import { POST as createArchive } from '@/app/api/files/archive/route'
import { hashSync } from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ArchiveOperation } from '@/lib/archives/operation'

const services = vi.hoisted(() => ({
  listArchive: vi.fn(),
  createAccountArchive: vi.fn(),
  extractArchive: vi.fn(),
  listSharedArchive: vi.fn(),
  downloadSharedArchiveEntry: vi.fn(),
}))
const findSource = vi.hoisted(() => vi.fn())

vi.mock('@/lib/archives/service', () => services)
vi.mock('@/lib/archives/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/archives/http')>()),
  archiveActor: async () => ({ user: { id: 'availability-owner' } }),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: findSource } },
}))

const origin = 'https://archive-availability.example'
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function post(path: string, body: unknown) {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Forwarded-For': randomUUID(),
    },
    body: JSON.stringify(body),
  })
}

function unfinishedPost(path: string) {
  const controller = new AbortController()
  let entered!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const cancelled = vi.fn()
  const body = new ReadableStream<Uint8Array>(
    {
      pull(stream) {
        stream.enqueue(new TextEncoder().encode('{"password":'))
        entered()
        return new Promise<void>(() => {})
      },
      cancel: cancelled,
    },
    { highWaterMark: 0 }
  )
  const request = new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Forwarded-For': randomUUID(),
    },
    body,
    signal: controller.signal,
    // Node requires duplex for an incoming streamed request body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  return { request, controller, reading, cancelled }
}

describe('shared archive handler admission does not starve owner work', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findSource.mockResolvedValue(null)
    for (const service of Object.values(services))
      service.mockResolvedValue({ reached: true })
  })

  it('keeps owner browse, creation, and extraction available while two anonymous bodies are unfinished', async () => {
    const manifest = unfinishedPost('/api/files/missing-manifest/archive/share')
    const entry = unfinishedPost('/api/files/missing-entry/archive/share/entry')
    const pending = [
      listSharedArchive(manifest.request, params('missing-manifest')),
      downloadSharedEntry(entry.request, params('missing-entry')),
    ]
    try {
      await Promise.all([manifest.reading, entry.reading])
      const responses = [
        await listArchive(
          new Request(`${origin}/api/files/source/archive`),
          params('source')
        ),
        await createArchive(
          post('/api/files/archive', {
            fileIds: ['source'],
            name: 'Collected',
            format: 'zip',
            folderId: null,
          })
        ),
        await extractArchive(
          post('/api/files/source/archive/extract', {
            folderId: null,
            name: 'Unpacked',
          }),
          params('source')
        ),
      ]
      expect(responses.map((response) => response.status)).toEqual([
        200, 200, 200,
      ])
      expect(services.listArchive).toHaveBeenCalledOnce()
      expect(services.createAccountArchive).toHaveBeenCalledOnce()
      expect(services.extractArchive).toHaveBeenCalledOnce()
      expect(services.listSharedArchive).not.toHaveBeenCalled()
      expect(services.downloadSharedArchiveEntry).not.toHaveBeenCalled()
    } finally {
      manifest.controller.abort()
      entry.controller.abort()
      await Promise.all(pending)
    }
    expect(manifest.cancelled).toHaveBeenCalledOnce()
    expect(entry.cancelled).toHaveBeenCalledOnce()
  })

  it.each([
    { source: 'missing', visibility: null, password: undefined, status: 404 },
    {
      source: 'private',
      visibility: 'PRIVATE',
      password: undefined,
      status: 404,
    },
    {
      source: 'protected',
      visibility: 'PUBLIC',
      password: undefined,
      status: 401,
    },
    {
      source: 'wrong-password',
      visibility: 'PUBLIC',
      password: 'incorrect',
      status: 401,
    },
  ])(
    'rejects $source sources before checking exhausted archive capacity',
    async ({ visibility, password, status }) => {
      findSource.mockResolvedValue(
        visibility
          ? {
              id: 'inaccessible',
              userId: 'someone-else',
              visibility,
              password: hashSync('public-test-fixture-password', 4),
            }
          : null
      )
      const running = [
        new ArchiveOperation('busy-owner-one', new AbortController().signal),
        new ArchiveOperation('busy-owner-two', new AbortController().signal),
      ]
      try {
        const responses = await Promise.all([
          listSharedArchive(
            post('/api/files/missing-manifest/archive/share', { password }),
            params('missing-manifest')
          ),
          downloadSharedEntry(
            post('/api/files/missing-entry/archive/share/entry', {
              path: 'guide/README.md',
              password,
            }),
            params('missing-entry')
          ),
        ])
        expect(responses.map((response) => response.status)).toEqual([
          status,
          status,
        ])
        expect(services.listSharedArchive).not.toHaveBeenCalled()
        expect(services.downloadSharedArchiveEntry).not.toHaveBeenCalled()
      } finally {
        await Promise.all(running.map((operation) => operation.release()))
      }
    }
  )
})
