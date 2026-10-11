import { GET } from '@/app/api/files/[id]/thumbnail/route'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setImmediate } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { S3StorageProvider } from '@/lib/storage/providers/s3'

const state = vi.hoisted(() => ({
  provider: undefined as S3StorageProvider | undefined,
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async () => ({
        id: 'thumbnail-fixture',
        name: 'fixture.png',
        mimeType: 'image/png',
        path: 'uploads/fixture.png',
        visibility: 'PUBLIC',
        userId: 'fixture-owner',
        password: null,
      }),
    },
  },
}))

// A controlled S3 GET response over a real loopback socket. The AWS SDK returns
// its normal IncomingMessage body; this does not mock SDK stream scheduling.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNwCU37DwAD3wH//5DuBQAAAABJRU5ErkJggg==',
  'base64'
)
const server = createServer((request, response) => {
  if (
    request.method !== 'GET' ||
    !request.url?.startsWith('/test-bucket/fixture.png')
  ) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(png.length),
  })
  response.end(png)
})

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No fixture port')
  state.provider = new S3StorageProvider({
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'public-test-key',
    secretAccessKey: 'public-test-secret',
    endpoint: `http://127.0.0.1:${address.port}`,
    forcePathStyle: true,
  })
  // Exercise the route's real audit wrapper, including asynchronous persistence.
  configureAuditWriter(async () => {
    await setImmediate()
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

describe('S3 thumbnail response bytes', () => {
  it('retains the HTTP object body until a delayed reader attaches', async () => {
    const stream = await state.provider!.getFileStream('uploads/fixture.png')
    await setImmediate()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(png)
  })

  it('serves a nonempty original image through the audited thumbnail route', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/files/thumbnail-fixture/thumbnail'
      ),
      { params: Promise.resolve({ id: 'thumbnail-fixture' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })
})
