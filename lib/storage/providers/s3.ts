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

    const maxRetries = 5
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
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

        const stream = response.Body as Readable

        stream.pause()

        stream.on('error', (error) => {
          console.error(`S3 stream error for ${key}:`, error)
        })

        process.nextTick(() => {
          stream.resume()
        })

        return stream
      } catch (error) {
        lastError = error as Error
        console.error(
          `S3 getFileStream attempt ${attempt} failed for ${key}:`,
          error
        )

        if (attempt === maxRetries) {
          throw lastError
        }

        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        )
      }
    }

    throw lastError || new Error('Failed to get file stream after retries')
  }

  async getFileUrl(path: string, expiresIn: number = 3600): Promise<string> {
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

    const downloadExpiresIn = expiresIn > 3600 ? expiresIn : 21600

    return await getSignedUrl(this.client, command, {
      expiresIn: downloadExpiresIn,
    })
  }

  async getDownloadUrl(path: string, filename?: string): Promise<string> {
    const key = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: filename
        ? `attachment; filename="${filename}"`
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
    const { PassThrough } = await import('stream')
    const passThrough = new PassThrough()

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

    let currentPartBuffer = Buffer.alloc(0)
    let currentPartNumber = 1
    let totalBytesUploaded = 0
    let isUploading = false
    let hasEnded = false
    let uploadError: Error | null = null
    const parts: { ETag: string; PartNumber: number }[] = []
    const maxPartSize = 5 * 1024 * 1024
    const maxConcurrentUploads = 3
    let activeUploads = 0

    const getPresignedUrl = async (partNumber: number): Promise<string> => {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      })
      return getSignedUrl(this.client, command, { expiresIn: 3600 })
    }

    const uploadPart = async (data: Buffer, partNum: number): Promise<void> => {
      try {
        activeUploads++

        const presignedUrl = await getPresignedUrl(partNum)

        const response = await fetch(presignedUrl, {
          method: 'PUT',
          body: data,
        })

        if (!response.ok) {
          throw new Error(
            `Failed to upload part ${partNum}: ${response.statusText}`
          )
        }

        const etag = response.headers.get('ETag')
        if (!etag) {
          throw new Error('Missing ETag in upload part response')
        }

        parts.push({
          ETag: etag.replace(/['"]/g, ''),
          PartNumber: partNum,
        })

        totalBytesUploaded += data.length

        passThrough.emit('s3Progress', {
          part: partNum,
          uploaded: totalBytesUploaded,
          etag,
        })
      } catch (error) {
        uploadError = error as Error
        throw error
      } finally {
        activeUploads--
        if (hasEnded && activeUploads === 0) {
          completeUpload().catch((error) => {
            passThrough.destroy(error as Error)
          })
        }
      }
    }

    passThrough.on('data', async (chunk: Buffer) => {
      if (uploadError) {
        passThrough.destroy(uploadError)
        return
      }

      currentPartBuffer = Buffer.concat([currentPartBuffer, chunk])

      while (
        currentPartBuffer.length >= maxPartSize &&
        activeUploads < maxConcurrentUploads &&
        !isUploading
      ) {
        isUploading = true
        const partData = currentPartBuffer.slice(0, maxPartSize)
        currentPartBuffer = currentPartBuffer.slice(maxPartSize)

        try {
          await uploadPart(partData, currentPartNumber++)
        } finally {
          isUploading = false
        }
      }
    })

    passThrough.on('end', () => {
      hasEnded = true
      if (activeUploads === 0) {
        completeUpload().catch((error) => {
          passThrough.destroy(error as Error)
        })
      }
    })

    const completeUpload = async () => {
      try {
        if (currentPartBuffer.length > 0) {
          await uploadPart(currentPartBuffer, currentPartNumber)
          currentPartBuffer = Buffer.alloc(0)
        }

        while (activeUploads > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber)

        await this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: sortedParts,
            },
          })
        )

        await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: key,
          })
        )
        passThrough.emit('s3Complete')
      } catch (error) {
        try {
          await this.client.send(
            new AbortMultipartUploadCommand({
              Bucket: this.bucket,
              Key: key,
              UploadId: uploadId,
            })
          )
        } catch (abortError) {
          console.error('Error aborting multipart upload:', abortError)
        }
        uploadError = error as Error
        passThrough.destroy(error as Error)
      }
    }

    passThrough.on('error', async (error) => {
      console.error('Stream error:', error)
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
          })
        )
      } catch (abortError) {
        console.error('Error aborting multipart upload:', abortError)
      }
    })

    return passThrough
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const oldPrefix =
      oldPath
        .replace(/^\/+/, '')
        .replace(/^uploads\//, '')
        .replace(/\/$/, '') + '/'
    const newPrefix =
      newPath
        .replace(/^\/+/, '')
        .replace(/^uploads\//, '')
        .replace(/\/$/, '') + '/'

    let continuationToken: string | undefined

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: oldPrefix,
        ContinuationToken: continuationToken,
      })

      const response = await this.client.send(listCommand)
      const objects = response.Contents || []

      await Promise.all(
        objects.map(async (object) => {
          if (!object.Key) return

          const newKey = object.Key.replace(oldPrefix, newPrefix)
          await this.client.send(
            new CopyObjectCommand({
              Bucket: this.bucket,
              CopySource: `${this.bucket}/${object.Key}`,
              Key: newKey,
            })
          )

          await this.client.send(
            new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: object.Key,
            })
          )
        })
      )

      continuationToken = response.NextContinuationToken
    } while (continuationToken)
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
