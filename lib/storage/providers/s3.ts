import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Transform, addAbortSignal } from 'node:stream'
import type { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

import { contentDisposition } from '@/lib/files/content-disposition'
import { loggers } from '@/lib/logger'

import { s3StorageTarget } from '../targets'
import type { StorageTarget } from '../targets'
import type { RangeOptions, S3Config, StorageProvider } from '../types'

const logger = loggers.storage.getChildLogger('s3')

export class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const
  readonly target: Readonly<Extract<StorageTarget, { provider: 's3' }>>

  private client: S3Client
  private bucket: string
  private endpoint?: string

  constructor(config: S3Config) {
    if (!config.bucket) throw new Error('S3 bucket name is required')
    if (!config.region) throw new Error('S3 region is required')
    if (!config.accessKeyId) throw new Error('S3 access key ID is required')
    if (!config.secretAccessKey)
      throw new Error('S3 secret access key is required')

    this.target = Object.freeze(s3StorageTarget(config))
    this.bucket = config.bucket
    this.endpoint = config.endpoint
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestHandler: {
        requestTimeout: 600000,
        connectionTimeout: 60000,
      },
      maxAttempts: 5,
      retryMode: 'adaptive',
      ...(config.endpoint && {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle ?? false,
      }),
    })
  }

  async uploadFile(
    file: Buffer,
    path: string,
    mimeType: string
  ): Promise<void> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
        ACL: key.startsWith('avatars/') ? 'public-read' : undefined,
      })
    )
  }

  async uploadStream(
    stream: Readable,
    path: string,
    mimeType: string,
    signal?: AbortSignal
  ): Promise<{ size: number }> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    let size = 0
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(null, chunk)
      },
    })

    // Sources can fail or be cancelled while the SDK is loading.
    let sourceError: Error | undefined
    counter.on('error', () => {})
    stream.on('error', (error) => {
      sourceError = error as Error
      counter.destroy(sourceError)
    })
    const { Upload } = await import('@aws-sdk/lib-storage')
    if (sourceError) throw sourceError
    if (signal?.aborted) {
      stream.destroy()
      counter.destroy()
      signal.throwIfAborted()
    }

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream.pipe(counter),
        ContentType: mimeType,
        ACL: key.startsWith('avatars/') ? 'public-read' : undefined,
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    })

    const abort = () => {
      stream.destroy(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('Upload cancelled')
      )
      void upload.abort().catch(() => {})
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await upload.done()
    } finally {
      signal?.removeEventListener('abort', abort)
    }

    return { size }
  }

  async deleteFile(path: string): Promise<void> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    )
  }

  async getFileStream(
    path: string,
    range?: RangeOptions,
    signal?: AbortSignal
  ): Promise<Readable> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const options: { Range?: string } = {}
    if (range) {
      options.Range = `bytes=${range.start || 0}-${typeof range.end !== 'undefined' ? range.end : ''}`
    }

    const maxRetries = 5
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      signal?.throwIfAborted()
      try {
        const response = await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...options,
          }),
          { abortSignal: signal }
        )

        if (!response.Body) {
          throw new Error('No file body returned from S3')
        }

        const stream = response.Body as Readable

        stream.on('error', (error) => {
          logger.error(`S3 stream error for ${key}`, error as Error, { key })
        })

        // The consumer starts reading. Resuming before it attaches discards
        // bytes while callers prepare responses or await other work.
        return signal ? addAbortSignal(signal, stream) : stream
      } catch (error) {
        signal?.throwIfAborted()
        lastError = error as Error
        logger.warn(`S3 getFileStream attempt ${attempt} failed`, {
          error,
          key,
          attempt,
          maxRetries,
        })

        if (attempt === maxRetries) {
          throw lastError
        }

        await delay(Math.pow(2, attempt) * 1000, undefined, { signal })
      }
    }

    throw lastError || new Error('Failed to get file stream after retries')
  }

  // S3 objects are reachable directly via a presigned/public URL, so callers
  // can redirect to it instead of streaming bytes through the app.
  async getPublicUrl(path: string): Promise<string | null> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    if (key.startsWith('avatars/')) {
      if (this.endpoint) {
        return `${this.endpoint}/${this.bucket}/${key}`
      }
      return `https://${this.bucket}.s3.amazonaws.com/${key}`
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    return await getSignedUrl(this.client, command, { expiresIn: 21600 })
  }

  async getDownloadUrl(path: string, filename?: string): Promise<string> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: filename
        ? contentDisposition(filename, 'attachment')
        : undefined,
    })

    return await getSignedUrl(this.client, command, { expiresIn: 21600 })
  }

  async getFileSize(path: string): Promise<number> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    const response = await this.client.send(command)
    return response.ContentLength || 0
  }

  async initializeMultipartUpload(
    path: string,
    mimeType: string
  ): Promise<string> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      })
    )

    if (!response.UploadId) {
      throw new Error('Failed to initialize multipart upload')
    }

    return response.UploadId
  }

  async getPresignedPartUploadUrl(
    path: string,
    uploadId: string,
    partNumber: number
  ): Promise<string> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    })

    return getSignedUrl(this.client, command, { expiresIn: 3600 })
  }

  async completeMultipartUpload(
    path: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[]
  ): Promise<void> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
        },
      })
    )
  }

  async uploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ ETag: string }> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const response = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: data,
      })
    )

    if (!response.ETag) {
      throw new Error('Missing ETag in upload part response')
    }

    return { ETag: response.ETag }
  }
}
