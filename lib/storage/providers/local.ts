import { createReadStream, createWriteStream } from 'fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import type { Writable as NodeWritable, Readable } from 'node:stream'
import { join } from 'path'

import { validateStoragePath } from '@/lib/security/paths'

import type { RangeOptions, StorageProvider } from '../types'

export class LocalStorageProvider implements StorageProvider {
  private activeWriteStreams = new Map<
    string,
    {
      stream: ReturnType<typeof createWriteStream>
      processedChunks: Set<number>
    }
  >()

  private multipartUploads = new Map<
    string,
    {
      path: string
      mimeType: string
      parts: Map<number, Buffer>
      stream: ReturnType<typeof createWriteStream>
    }
  >()

  async initializeMultipartUpload(
    path: string,
    mimeType: string
  ): Promise<string> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })

    const uploadId = `local-${Date.now()}-${Math.random().toString(36).substring(2)}`

    const stream = createWriteStream(fullPath)

    this.multipartUploads.set(uploadId, {
      path: fullPath,
      mimeType,
      parts: new Map(),
      stream,
    })

    return uploadId
  }

  async uploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ ETag: string }> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('Upload not found')
    }

    upload.parts.set(partNumber, data)

    const etag = `"${uploadId}-${partNumber}-${data.length}"`

    const parts = Array.from(upload.parts.entries()).sort(([a], [b]) => a - b)

    let nextExpectedPart = 1
    for (const [partNum, partData] of parts) {
      if (partNum !== nextExpectedPart) break

      await new Promise<void>((resolve, reject) => {
        upload.stream.write(partData, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })

      upload.parts.delete(partNum)
      nextExpectedPart++
    }

    return { ETag: etag }
  }

  async getPresignedPartUploadUrl(
    path: string,
    uploadId: string,
    partNumber: number
  ): Promise<string> {
    return `local://${uploadId}/${partNumber}`
  }

  async completeMultipartUpload(
    path: string,
    uploadId: string,
    _parts: { ETag: string; PartNumber: number }[]
  ): Promise<void> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new Error('Upload not found')
    }

    try {
      if (upload.parts.size > 0) {
        const remainingParts = Array.from(upload.parts.entries()).sort(
          ([a], [b]) => a - b
        )

        for (const [, partData] of remainingParts) {
          await new Promise<void>((resolve, reject) => {
            upload.stream.write(partData, (error: Error | null | undefined) => {
              if (error) reject(error)
              else resolve()
            })
          })
        }
      }

      await new Promise<void>((resolve, reject) => {
        upload.stream.end((error: Error | null | undefined) => {
          if (error) reject(error)
          else resolve()
        })
      })
    } finally {
      this.multipartUploads.delete(uploadId)
    }
  }

  async uploadFile(
    file: Buffer,
    path: string,
    _mimeType: string
  ): Promise<void> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, file)
  }

  async deleteFile(path: string): Promise<void> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    await unlink(fullPath)
  }

  async getFileStream(path: string, range?: RangeOptions): Promise<Readable> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    const options: { start?: number; end?: number } = {}
    if (range) {
      if (typeof range.start !== 'undefined') options.start = range.start
      if (typeof range.end !== 'undefined') options.end = range.end
    }
    return createReadStream(fullPath, options)
  }

  async getFileUrl(path: string): Promise<string> {
    const baseUrl = (
      process.env.NEXTAUTH_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '')
    const cleanPath = path.replace(/^\/+/, '').replace(/^uploads\//, '')

    if (cleanPath.match(/\.(mp4|webm|mov|avi|mkv)$/i)) {
      return `${baseUrl}/api/files/${cleanPath}`
    }

    return `${baseUrl}/${cleanPath}/raw`
  }

  async getFileSize(path: string): Promise<number> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    const stats = await stat(fullPath)
    return stats.size
  }

  async uploadChunkedFile(
    chunksDir: string,
    targetPath: string,
    _mimeType: string
  ): Promise<void> {
    const fullPath = targetPath.startsWith('public/')
      ? targetPath
      : join(process.cwd(), targetPath)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })

    const chunkFiles = await readdir(chunksDir)
    const sortedChunks = chunkFiles
      .filter((file) => file.startsWith('chunk-'))
      .sort((a, b) => {
        const numA = parseInt(a.split('-')[1])
        const numB = parseInt(b.split('-')[1])
        return numA - numB
      })

    if (!this.activeWriteStreams.has(fullPath)) {
      this.activeWriteStreams.set(fullPath, {
        stream: createWriteStream(fullPath),
        processedChunks: new Set(),
      })
    }

    const { stream, processedChunks } = this.activeWriteStreams.get(fullPath)!

    for (const chunkFile of sortedChunks) {
      const chunkNumber = parseInt(chunkFile.split('-')[1])

      if (processedChunks.has(chunkNumber)) continue

      const chunkPath = join(chunksDir, chunkFile)
      const chunkData = await readFile(chunkPath)

      await new Promise<void>((resolve, reject) => {
        stream.write(chunkData, (err: Error | null | undefined) => {
          if (err) reject(err)
          else {
            processedChunks.add(chunkNumber)
            resolve()
          }
        })
      })
    }

    if (processedChunks.size === sortedChunks.length) {
      await new Promise<void>((resolve, reject) => {
        const callback = (err: Error | null | undefined) => {
          if (err) reject(err)
          else {
            this.activeWriteStreams.delete(fullPath)
            resolve()
          }
        }
        stream.end(callback)
      })
    }
  }

  async createWriteStream(
    path: string,
    _mimeType: string
  ): Promise<NodeWritable> {
    const validPath = validateStoragePath(path)
    const fullPath = join(process.cwd(), validPath)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })
    return createWriteStream(fullPath)
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const validOldPath = validateStoragePath(oldPath)
    const validNewPath = validateStoragePath(newPath)
    const fullOldPath = join(process.cwd(), validOldPath)
    const fullNewPath = join(process.cwd(), validNewPath)

    await mkdir(fullNewPath, { recursive: true })

    await rename(fullOldPath, fullNewPath)
  }
}
