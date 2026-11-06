import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { isMissingObject } from '@/lib/storage/missing'
import { S3StorageProvider } from '@/lib/storage/providers/s3'

// A loopback S3 endpoint, so the SDK's own retry handling runs as it does
// against a real service.
const requests: string[] = []
const server = createServer((request, response) => {
  requests.push(request.url ?? '')
  const [code, message, status] = request.url?.startsWith(
    '/test-bucket/missing?'
  )
    ? ['NoSuchKey', 'The specified key does not exist.', 404]
    : ['InternalError', 'We encountered an internal error.', 500]
  response
    .writeHead(status, { 'Content-Type': 'application/xml' })
    .end(
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><RequestId>fixture</RequestId></Error>`
    )
})
let provider: S3StorageProvider

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No fixture port')
  provider = new S3StorageProvider({
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'public-test-key',
    secretAccessKey: 'public-test-secret',
    endpoint: `http://127.0.0.1:${address.port}`,
    forcePathStyle: true,
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

beforeEach(() => {
  requests.length = 0
})

describe('S3 reads', () => {
  it('reports a missing object after one request, without waiting', async () => {
    const started = Date.now()
    const failure = await provider
      .getFileStream('uploads/missing')
      .catch((error: unknown) => error)
    expect(isMissingObject(failure)).toBe(true)
    expect(requests).toEqual(['/test-bucket/missing?x-id=GetObject'])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('leaves retrying a failing read to the client, five attempts in all', async () => {
    const failure = await provider
      .getFileStream('uploads/broken')
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'InternalError' })
    expect(requests).toHaveLength(5)
  }, 15000)
})
