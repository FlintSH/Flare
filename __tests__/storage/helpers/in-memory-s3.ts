import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { Readable } from 'node:stream'

const META = { $metadata: {} }

interface StoredObject {
  body: Buffer
  contentType?: string
}

interface MultipartUpload {
  key: string
  contentType?: string
  parts: Map<number, Buffer>
}

class NotFoundError extends Error {
  name = 'NotFound'
  $metadata = { httpStatusCode: 404 }
  Code = 'NoSuchKey'
  constructor() {
    super('NoSuchKey: The specified key does not exist.')
  }
}

async function toBuffer(
  body: Buffer | Uint8Array | string | Readable | undefined
): Promise<Buffer> {
  if (body === undefined) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  // Readable stream
  const chunks: Buffer[] = []
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * A faithful, in-memory S3 backend wired through aws-sdk-client-mock. It
 * implements the subset of S3 semantics the storage provider relies on
 * (objects, ranged reads, multipart uploads, listing, copy) backed by a Map,
 * so the S3StorageProvider can run the exact same contract suite as the local
 * provider without any network access.
 */
export function createInMemoryS3() {
  const store = new Map<string, StoredObject>()
  const uploads = new Map<string, MultipartUpload>()

  const mock = mockClient(S3Client)

  mock.on(PutObjectCommand).callsFake(async (input) => {
    const body = await toBuffer(input.Body)
    store.set(input.Key, { body, contentType: input.ContentType })
    return { ...META, ETag: `"${input.Key}-${body.length}"` }
  })

  mock.on(GetObjectCommand).callsFake(async (input) => {
    const object = store.get(input.Key)
    if (!object) throw new NotFoundError()

    let body = object.body
    let contentRange: string | undefined

    if (input.Range) {
      const match = /bytes=(\d*)-(\d*)/.exec(input.Range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? parseInt(match[2], 10) : object.body.length - 1
        body = object.body.subarray(start, end + 1)
        contentRange = `bytes ${start}-${end}/${object.body.length}`
      }
    }

    return {
      ...META,
      Body: Readable.from([body]) as never,
      ContentLength: body.length,
      ContentType: object.contentType,
      ContentRange: contentRange,
    }
  })

  mock.on(HeadObjectCommand).callsFake(async (input) => {
    const object = store.get(input.Key)
    if (!object) throw new NotFoundError()
    return {
      ...META,
      ContentLength: object.body.length,
      ContentType: object.contentType,
    }
  })

  mock.on(DeleteObjectCommand).callsFake(async (input) => {
    store.delete(input.Key)
    return { ...META }
  })

  mock.on(CreateMultipartUploadCommand).callsFake(async (input) => {
    const uploadId = `mpu-${Math.random().toString(36).slice(2)}`
    uploads.set(uploadId, {
      key: input.Key,
      contentType: input.ContentType,
      parts: new Map(),
    })
    return { ...META, UploadId: uploadId, Key: input.Key, Bucket: input.Bucket }
  })

  mock.on(UploadPartCommand).callsFake(async (input) => {
    const upload = uploads.get(input.UploadId)
    if (!upload) throw new Error('NoSuchUpload')
    const body = await toBuffer(input.Body)
    upload.parts.set(input.PartNumber, body)
    return { ...META, ETag: `"part-${input.PartNumber}-${body.length}"` }
  })

  mock.on(CompleteMultipartUploadCommand).callsFake(async (input) => {
    const upload = uploads.get(input.UploadId)
    if (!upload) throw new Error('NoSuchUpload')
    const ordered = [...(input.MultipartUpload?.Parts ?? [])].sort(
      (a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)
    )
    const buffers = ordered.map((p) => upload.parts.get(p.PartNumber ?? 0))
    if (buffers.some((b) => b === undefined)) {
      throw new Error('InvalidPart')
    }
    const body = Buffer.concat(buffers as Buffer[])
    store.set(upload.key, { body, contentType: upload.contentType })
    uploads.delete(input.UploadId)
    return { ...META, Key: upload.key, ETag: `"${upload.key}-${body.length}"` }
  })

  mock.on(AbortMultipartUploadCommand).callsFake(async (input) => {
    uploads.delete(input.UploadId)
    return { ...META }
  })

  mock.on(ListObjectsV2Command).callsFake(async (input) => {
    const prefix = input.Prefix ?? ''
    const contents = [...store.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ Key: key, Size: store.get(key)!.body.length }))
    return { ...META, Contents: contents, IsTruncated: false }
  })

  mock.on(CopyObjectCommand).callsFake(async (input) => {
    // CopySource is "<bucket>/<key>"; strip the leading bucket segment.
    const source = decodeURIComponent(input.CopySource ?? '')
    const sourceKey = source.substring(source.indexOf('/') + 1)
    const object = store.get(sourceKey)
    if (!object) throw new NotFoundError()
    store.set(input.Key, { body: object.body, contentType: object.contentType })
    return { ...META, CopyObjectResult: {} }
  })

  return {
    mock,
    // Clears stored data but keeps the command handlers in place.
    clear: () => {
      store.clear()
      uploads.clear()
    },
    // Fully removes the mock and restores the real S3Client behavior.
    restore: () => {
      store.clear()
      uploads.clear()
      mock.restore()
    },
    store,
  }
}
