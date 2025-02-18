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

import type { RangeOptions, StorageProvider } from '../types'

export class LocalStorageProvider implements StorageProvider {
  private activeWriteStreams = new Map<
    string,
    {
      stream: ReturnType<typeof createWriteStream>
      processedChunks: Set<number>
    }
  >()

  async uploadFile(
    file: Buffer,
    path: string,
    mimeType: string /* eslint-disable-line @typescript-eslint/no-unused-vars */
  ): Promise<void> {
    const fullPath = path.startsWith('public/')
      ? path
      : join(process.cwd(), path)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, file)
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = path.startsWith('public/')
      ? path
      : join(process.cwd(), path)
    await unlink(fullPath)
  }

  async getFileStream(path: string, range?: RangeOptions): Promise<Readable> {
    const fullPath = path.startsWith('public/')
      ? path
      : join(process.cwd(), path)
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
    const fullPath = path.startsWith('public/')
      ? path
      : join(process.cwd(), path)
    const stats = await stat(fullPath)
    return stats.size
  }

  async uploadChunkedFile(
    chunksDir: string,
    targetPath: string,
    _mimeType: string /* eslint-disable-line @typescript-eslint/no-unused-vars */
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

  async createWriteStream(path: string): Promise<NodeWritable> {
    const fullPath = path.startsWith('public/')
      ? path
      : join(process.cwd(), path)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })
    return createWriteStream(fullPath)
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const fullOldPath = oldPath.startsWith('public/')
      ? oldPath
      : join(process.cwd(), oldPath)
    const fullNewPath = newPath.startsWith('public/')
      ? newPath
      : join(process.cwd(), newPath)

    // Create the new directory if it doesn't exist
    await mkdir(fullNewPath, { recursive: true })

    // Move the directory
    await rename(fullOldPath, fullNewPath)
  }
}
