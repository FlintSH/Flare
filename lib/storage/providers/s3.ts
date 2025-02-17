import {
  AbortMultipartUploadCommand,
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
import type { Writable as NodeWritable, Readable } from 'node:stream'

import type { RangeOptions, S3Config, StorageProvider } from '../types'

export class S3StorageProvider implements StorageProvider {
  private client: S3Client
  private bucket: string
  private endpoint?: string

  constructor(config: S3Config) {
    if (!config.bucket) throw new Error('S3 bucket name is required')
    if (!config.region) throw new Error('S3 region is required')
    if (!config.accessKeyId) throw new Error('S3 access key ID is required')
    if (!config.secretAccessKey)
      throw new Error('S3 secret access key is required')

    this.bucket = config.bucket
    this.endpoint = config.endpoint
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
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
      })
    )
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

  async getFileStream(path: string, range?: RangeOptions): Promise<Readable> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const options: { Range?: string } = {}
    if (range) {
      options.Range = `bytes=${range.start || 0}-${typeof range.end !== 'undefined' ? range.end : ''}`
    }

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...options,
      })
    )

    if (!response.Body) {
      throw new Error('No file body returned from S3')
    }

    return response.Body as Readable
  }

  async getFileUrl(path: string): Promise<string> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    if (this.endpoint) {
      return `${this.endpoint}/${this.bucket}/${key}`
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })

    return await getSignedUrl(this.client, command, { expiresIn: 3600 })
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

  async uploadChunkedFile(
    chunksDir: string,
    targetPath: string,
    mimeType: string
  ): Promise<void> {
    const key = targetPath.replace(/^\/+/, '').replace(/^uploads\//, '')
    const createResponse = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      })
    )

    const uploadId = createResponse.UploadId
    if (!uploadId) {
      throw new Error('Failed to create multipart upload')
    }

    try {
      const { readdir, readFile } = await import('fs/promises')
      const { join } = await import('path')

      const chunkFiles = await readdir(chunksDir)
      const sortedChunks = chunkFiles
        .filter((file) => file.startsWith('chunk-'))
        .sort((a, b) => {
          const numA = parseInt(a.split('-')[1])
          const numB = parseInt(b.split('-')[1])
          return numA - numB
        })

      const uploadPromises = sortedChunks.map(async (chunkFile, index) => {
        const chunkPath = join(chunksDir, chunkFile)
        const chunkData = await readFile(chunkPath)
        const response = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            PartNumber: index + 1,
            UploadId: uploadId,
            Body: chunkData,
          })
        )

        if (!response.ETag) {
          throw new Error('Missing ETag in upload part response')
        }

        return {
          ETag: response.ETag,
          PartNumber: index + 1,
        }
      })

      const parts = await Promise.all(uploadPromises)

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      )
    } catch (error) {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        })
      )
      throw error
    }
  }

  async createWriteStream(
    path: string,
    mimeType: string
  ): Promise<NodeWritable> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const createResponse = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      })
    )

    const uploadId = createResponse.UploadId
    if (!uploadId) {
      throw new Error('Failed to create multipart upload')
    }

    const { PassThrough } = await import('stream')
    const passThrough = new PassThrough()

    let partNumber = 1
    let buffer = Buffer.alloc(0)
    const parts: { ETag: string; PartNumber: number }[] = []
    const minPartSize = 5 * 1024 * 1024 // 5MB minimum part size for S3

    passThrough.on('data', async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      if (buffer.length >= minPartSize) {
        try {
          const response = await this.client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: key,
              PartNumber: partNumber,
              UploadId: uploadId,
              Body: buffer,
            })
          )

          if (!response.ETag) {
            throw new Error('Missing ETag in upload part response')
          }

          parts.push({
            ETag: response.ETag,
            PartNumber: partNumber,
          })

          partNumber++
          buffer = Buffer.alloc(0)
        } catch (error) {
          passThrough.destroy(error as Error)
        }
      }
    })

    passThrough.on('end', async () => {
      try {
        if (buffer.length > 0) {
          const response = await this.client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: key,
              PartNumber: partNumber,
              UploadId: uploadId,
              Body: buffer,
            })
          )

          if (!response.ETag) {
            throw new Error('Missing ETag in upload part response')
          }

          parts.push({
            ETag: response.ETag,
            PartNumber: partNumber,
          })
        }

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
      } catch (error) {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
          })
        )
        passThrough.destroy(error as Error)
      }
    })

    passThrough.on('error', async () => {
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
          })
        )
      } catch (abortError) {
        console.error('Failed to abort multipart upload:', abortError)
      }
    })

    return passThrough
  }
}
