import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import type { StorageProvider } from '@/lib/storage'

const boundary = 'flare-test-boundary'

// Browsers and curl write the filename parameter as raw UTF-8 bytes.
function multipart(filename: Buffer, body = 'fixture bytes') {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nPUBLIC\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="`
    ),
    filename,
    Buffer.from(
      `"\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--${boundary}--\r\n`
    ),
  ])
}

function request(payload: Buffer) {
  return new Request('https://flare.test/api/files', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(payload),
  })
}

const storage = {
  uploadStream: async (stream: Readable) => {
    let size = 0
    for await (const chunk of stream) size += chunk.length
    return { size }
  },
} as unknown as StorageProvider

function parse(
  payload: Buffer,
  resolveDestination: (info: { filename: string }) => Promise<{
    filePath: string
    urlPath: string
    displayName: string
    urlSafeName: string
  }>,
  options: {
    storageProvider?: StorageProvider
    maxBytes?: number
    quotaLimitBytes?: number
  } = {}
) {
  return parseSingleFileUpload({
    req: request(payload),
    storageProvider: options.storageProvider ?? storage,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    quotaLimitBytes: options.quotaLimitBytes ?? Infinity,
    resolveDestination,
  })
}

const destination = async ({ filename }: { filename: string }) => ({
  filePath: 'uploads/owner/key/file.bin',
  urlPath: '/owner/file.bin',
  displayName: filename,
  urlSafeName: 'file.bin',
})

describe('multipart uploads', () => {
  it('keeps a UTF-8 filename instead of reading it as Latin-1', async () => {
    const seen: string[] = []
    const result = await parse(
      multipart(Buffer.from('café 日本語.txt', 'utf8')),
      async ({ filename }) => {
        seen.push(filename)
        return {
          filePath: 'uploads/owner/key/file.txt',
          urlPath: '/owner/file.txt',
          displayName: filename,
          urlSafeName: 'file.txt',
        }
      }
    )
    expect(seen).toEqual(['café 日本語.txt'])
    expect(result.upload).toMatchObject({
      displayName: 'café 日本語.txt',
      size: 'fixture bytes'.length,
    })
    expect(result.fields).toEqual({ visibility: 'PUBLIC' })
  })

  it('still reads an RFC 5987 filename* parameter', async () => {
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename*=UTF-8''na%C3%AFve.txt\r\n` +
        `Content-Type: text/plain\r\n\r\nx\r\n--${boundary}--\r\n`
    )
    const result = await parse(payload, async ({ filename }) => ({
      filePath: 'uploads/owner/key/naive.txt',
      urlPath: '/owner/naive.txt',
      displayName: filename,
      urlSafeName: 'naive.txt',
    }))
    expect(result.upload?.displayName).toBe('naïve.txt')
  })

  it('fails promptly when the destination is rejected instead of stalling the request', async () => {
    const started = Date.now()
    await expect(
      parse(
        multipart(Buffer.from('report.txt'), 'x'.repeat(256 * 1024)),
        async () => {
          throw new Error('Invalid filename.')
        }
      )
    ).rejects.toThrow('Invalid filename.')
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 10_000)

  it('fails promptly when storage rejects the bytes', async () => {
    const failing = {
      uploadStream: async (stream: Readable) => {
        for await (const _chunk of stream) throw new Error('bucket unavailable')
        return { size: 0 }
      },
    } as unknown as StorageProvider
    const started = Date.now()
    await expect(
      parse(
        multipart(Buffer.from('report.txt'), 'x'.repeat(256 * 1024)),
        destination,
        { storageProvider: failing }
      )
    ).rejects.toThrow('bucket unavailable')
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 10_000)

  it.each([
    ['size', { maxBytes: 1024, quotaLimitBytes: Infinity }],
    ['quota', { maxBytes: 1024 * 1024, quotaLimitBytes: 1024 }],
  ] as const)(
    'reports the %s limit instead of an error',
    async (limitHit, limits) => {
      const result = await parse(
        multipart(Buffer.from('big.bin'), 'x'.repeat(64 * 1024)),
        destination,
        limits
      )
      expect(result).toMatchObject({ upload: null, limitHit })
    },
    10_000
  )
})
