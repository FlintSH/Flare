import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { S3StorageProvider } from '@/lib/storage/providers/s3'

const provider = () =>
  new S3StorageProvider({
    bucket: 'test',
    region: 'us-east-1',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture',
    endpoint: 'http://127.0.0.1:1',
  })

describe('S3 archive cancellation', () => {
  it('rejects an already cancelled read without attempting a network request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('deadline'))
    await expect(
      provider().getFileStream('uploads/test', undefined, controller.signal)
    ).rejects.toThrow('deadline')
  })
  it('stops a waiting upload and its input when cancelled', async () => {
    const controller = new AbortController()
    const stream = new Readable({ read() {} })
    const upload = provider().uploadStream(
      stream,
      'uploads/test',
      'application/octet-stream',
      controller.signal
    )
    const rejected = expect(upload).rejects.toThrow()
    setTimeout(() => controller.abort(new Error('deadline')), 10)
    await rejected
    expect(stream.destroyed).toBe(true)
  })
})
