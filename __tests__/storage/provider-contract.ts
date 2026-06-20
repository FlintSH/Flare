import { type Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import type { StorageProvider } from '@/lib/storage/types'

export interface ContractContext {
  provider: StorageProvider
  // Unique path prefix (under uploads/) for a given test run, to avoid
  // collisions between providers/tests sharing a backend.
  prefix: string
  cleanup: () => Promise<void>
}

export interface ContractOptions {
  // S3's createWriteStream uploads via a presigned URL over real HTTP, which
  // the in-memory backend cannot serve. Disable it there.
  testWriteStream?: boolean
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

let counter = 0
function uniqueName(prefix: string, name: string): string {
  counter += 1
  return `${prefix}/${counter}-${name}`
}

/**
 * The single source of truth for how a StorageProvider must behave. Run it
 * against every backend (local, S3, future providers) so they are guaranteed
 * interchangeable.
 */
export function runStorageProviderContract(
  label: string,
  setup: () => Promise<ContractContext>,
  options: ContractOptions = {}
) {
  const { testWriteStream = true } = options

  describe(`StorageProvider contract: ${label}`, () => {
    let ctx: ContractContext

    async function makeProvider() {
      ctx = await setup()
      return ctx
    }

    it('uploadFile + getFileSize + getFileStream round-trips bytes', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const data = Buffer.from('hello storage world')
        const path = uniqueName(prefix, 'roundtrip.bin')

        await provider.uploadFile(data, path, 'application/octet-stream')

        expect(await provider.getFileSize(path)).toBe(data.length)
        const read = await streamToBuffer(await provider.getFileStream(path))
        expect(read.equals(data)).toBe(true)
      } finally {
        await ctx.cleanup()
      }
    })

    it('getFileStream honors inclusive ranges and open-ended ranges', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const data = Buffer.from('0123456789')
        const path = uniqueName(prefix, 'range.bin')
        await provider.uploadFile(data, path, 'application/octet-stream')

        const slice = await streamToBuffer(
          await provider.getFileStream(path, { start: 2, end: 5 })
        )
        expect(slice.toString()).toBe('2345')

        const tail = await streamToBuffer(
          await provider.getFileStream(path, { start: 7 })
        )
        expect(tail.toString()).toBe('789')
      } finally {
        await ctx.cleanup()
      }
    })

    it('uploadStream reports size and stores identical bytes', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const { Readable } = await import('node:stream')
        const data = Buffer.from('streamed content here '.repeat(100))
        const path = uniqueName(prefix, 'streamed.bin')

        const { size } = await provider.uploadStream(
          Readable.from([data]),
          path,
          'text/plain'
        )
        expect(size).toBe(data.length)

        const read = await streamToBuffer(await provider.getFileStream(path))
        expect(read.equals(data)).toBe(true)
      } finally {
        await ctx.cleanup()
      }
    })

    it('multipart upload concatenates out-of-order parts correctly', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const path = uniqueName(prefix, 'multipart.bin')
        const part1 = Buffer.from('A'.repeat(16))
        const part2 = Buffer.from('B'.repeat(16))
        const part3 = Buffer.from('C'.repeat(8))

        const uploadId = await provider.initializeMultipartUpload(
          path,
          'application/octet-stream'
        )

        // Upload out of order on purpose.
        const r2 = await provider.uploadPart(path, uploadId, 2, part2)
        const r1 = await provider.uploadPart(path, uploadId, 1, part1)
        const r3 = await provider.uploadPart(path, uploadId, 3, part3)

        await provider.completeMultipartUpload(path, uploadId, [
          { ETag: r1.ETag, PartNumber: 1 },
          { ETag: r2.ETag, PartNumber: 2 },
          { ETag: r3.ETag, PartNumber: 3 },
        ])

        const read = await streamToBuffer(await provider.getFileStream(path))
        expect(read.equals(Buffer.concat([part1, part2, part3]))).toBe(true)
        expect(await provider.getFileSize(path)).toBe(40)
      } finally {
        await ctx.cleanup()
      }
    })

    it('deleteFile removes the object', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const path = uniqueName(prefix, 'to-delete.bin')
        await provider.uploadFile(
          Buffer.from('bye'),
          path,
          'application/octet-stream'
        )
        expect(await provider.getFileSize(path)).toBe(3)

        await provider.deleteFile(path)
        await expect(provider.getFileSize(path)).rejects.toBeDefined()
      } finally {
        await ctx.cleanup()
      }
    })

    it('renameFolder moves all objects under a prefix', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const base = uniqueName(prefix, 'folder')
        const oldDir = `${base}/old`
        const newDir = `${base}/new`
        const a = Buffer.from('file-a')
        const b = Buffer.from('file-b')

        await provider.uploadFile(
          a,
          `${oldDir}/a.bin`,
          'application/octet-stream'
        )
        await provider.uploadFile(
          b,
          `${oldDir}/sub/b.bin`,
          'application/octet-stream'
        )

        await provider.renameFolder(oldDir, newDir)

        const readA = await streamToBuffer(
          await provider.getFileStream(`${newDir}/a.bin`)
        )
        const readB = await streamToBuffer(
          await provider.getFileStream(`${newDir}/sub/b.bin`)
        )
        expect(readA.equals(a)).toBe(true)
        expect(readB.equals(b)).toBe(true)

        await expect(
          provider.getFileSize(`${oldDir}/a.bin`)
        ).rejects.toBeDefined()
      } finally {
        await ctx.cleanup()
      }
    })

    it('getFileUrl returns a non-empty string', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        const path = uniqueName(prefix, 'url.bin')
        await provider.uploadFile(
          Buffer.from('x'),
          path,
          'application/octet-stream'
        )
        const url = await provider.getFileUrl(path)
        expect(typeof url).toBe('string')
        expect(url.length).toBeGreaterThan(0)
      } finally {
        await ctx.cleanup()
      }
    })

    it('getDownloadUrl returns a non-empty string', async () => {
      const { provider, prefix } = await makeProvider()
      try {
        if (typeof provider.getDownloadUrl !== 'function') {
          // Optional in the legacy interface; skip if unimplemented.
          return
        }
        const path = uniqueName(prefix, 'download.bin')
        await provider.uploadFile(
          Buffer.from('x'),
          path,
          'application/octet-stream'
        )
        const url = await provider.getDownloadUrl(path, 'download.bin')
        expect(typeof url).toBe('string')
        expect(url.length).toBeGreaterThan(0)
      } finally {
        await ctx.cleanup()
      }
    })

    if (testWriteStream) {
      it('createWriteStream writes data that can be read back', async () => {
        const { provider, prefix } = await makeProvider()
        try {
          const path = uniqueName(prefix, 'writestream.bin')
          const data = Buffer.from('written via stream')

          const writeStream = await provider.createWriteStream(
            path,
            'application/octet-stream'
          )
          await new Promise<void>((resolve, reject) => {
            writeStream.on('error', reject)
            writeStream.on('finish', () => resolve())
            writeStream.on('close', () => resolve())
            writeStream.end(data)
          })

          const read = await streamToBuffer(await provider.getFileStream(path))
          expect(read.equals(data)).toBe(true)
        } finally {
          await ctx.cleanup()
        }
      })
    }
  })
}
