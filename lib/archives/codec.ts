import archiver from 'archiver'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32, createGunzip } from 'node:zlib'
import * as tar from 'tar-stream'
import { openPromise } from 'yauzl'

import { folderNameSchema } from '@/lib/folders/schema'

import { ArchiveError } from './errors'
import {
  ARCHIVE_LIMITS,
  type ArchiveEntry,
  type ArchiveManifest,
  type ArchiveOutputFormat,
  archiveBasename,
  detectArchiveFormat,
} from './shared'

/** Reject aliasing paths before any account file or directory is created. */
export function validateArchivePath(raw: string, directory = false): string {
  if (
    !raw ||
    raw.length > ARCHIVE_LIMITS.pathLength ||
    /[\\:\p{Cc}\p{Cf}\uFFFD]/u.test(raw) ||
    raw.startsWith('/')
  )
    throw new ArchiveError(
      'The archive contains an unsafe or excessively long path.'
    )
  let path = raw
  while (path.startsWith('./')) path = path.slice(2)
  if (directory) path = path.replace(/\/$/, '')
  if (!path && directory) return '' // A conventional TAR root entry (./).
  const parts = path.split('/')
  if (
    parts.length > ARCHIVE_LIMITS.pathDepth ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw new ArchiveError(
      'Archive paths must be relative and at most 20 levels deep.'
    )
  const normalized = parts.map((part, index) => {
    if (directory || index < parts.length - 1) {
      const parsed = folderNameSchema.safeParse(part)
      if (!parsed.success)
        throw new ArchiveError(
          'An archive folder name does not fit Flare’s folder rules (80 characters, no controls or slashes).'
        )
      return parsed.data
    }
    const value = part.normalize('NFKC')
    if (
      value.length > 255 ||
      !value.trim() ||
      value === '.' ||
      value === '..' ||
      /[\\/:\p{Cc}\p{Cf}]/u.test(value)
    )
      throw new ArchiveError(
        'An archive filename is unsafe or longer than 255 characters.'
      )
    return value
  })
  return normalized.join('/')
}

/** Also tracks inferred directories, so file/directory and case collisions fail. */
class ManifestBuilder {
  entries: ArchiveEntry[] = []
  totalBytes = 0
  fileCount = 0
  count = 0
  nodes = new Map<
    string,
    {
      path: string
      sourcePath: string
      type: ArchiveEntry['type']
      explicit: boolean
    }
  >()

  add(
    raw: string,
    type: ArchiveEntry['type'],
    size: number
  ): ArchiveEntry | null {
    if (++this.count > ARCHIVE_LIMITS.entries)
      throw new ArchiveError('Archives can contain at most 1,000 entries.', 413)
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      (type === 'directory' && size !== 0)
    )
      throw new ArchiveError('The archive contains an invalid entry size.')
    if (size > ARCHIVE_LIMITS.fileBytes)
      throw new ArchiveError('An archive member exceeds 256 MiB.', 413)
    const path = validateArchivePath(raw, type === 'directory')
    if (!path) return null
    const parts = path.split('/')
    const sourceParts = raw
      .replace(/^(\.\/)+/, '')
      .replace(/\/$/, '')
      .split('/')
    for (let index = 0; index < parts.length; index++) {
      const nodePath = parts.slice(0, index + 1).join('/')
      const last = index === parts.length - 1
      const nodeType = last ? type : 'directory'
      const sourcePath = sourceParts.slice(0, index + 1).join('/')
      const key = nodePath.toLowerCase()
      const existing = this.nodes.get(key)
      if (
        existing &&
        (existing.path !== nodePath ||
          existing.sourcePath !== sourcePath ||
          existing.type !== nodeType ||
          (last && existing.explicit))
      )
        throw new ArchiveError(
          'The archive contains duplicate or conflicting file and folder names.'
        )
      this.nodes.set(key, {
        path: nodePath,
        sourcePath,
        type: nodeType,
        explicit: last || existing?.explicit || false,
      })
      if (this.nodes.size > ARCHIVE_LIMITS.entries)
        throw new ArchiveError(
          'Archives can contain at most 1,000 files and folders, including parent folders.',
          413
        )
    }
    this.totalBytes += size
    if (this.totalBytes > ARCHIVE_LIMITS.expandedBytes)
      throw new ArchiveError('Expanded archive contents exceed 512 MiB.', 413)
    if (type === 'file') this.fileCount++
    const entry = { path, type, size }
    this.entries.push(entry)
    return entry
  }
}

export function byteLimit(maximum: number, message: string) {
  let bytes = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > maximum ? new ArchiveError(message, 413) : null, chunk)
    },
  })
}

async function consume(
  stream: Readable,
  entry: ArchiveEntry,
  options: { directory?: string; signal?: AbortSignal },
  expectedCrc?: number,
  unknownSize = false
) {
  let bytes = 0
  let checksum = 0
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (
        bytes > ARCHIVE_LIMITS.fileBytes ||
        (!unknownSize && bytes > entry.size)
      ) {
        callback(
          new ArchiveError(
            'An archive member exceeds its declared size or the 256 MiB limit.',
            413
          )
        )
        return
      }
      if (expectedCrc !== undefined) checksum = crc32(chunk, checksum)
      callback(null, chunk)
    },
  })
  const diskPath =
    options.directory && entry.type === 'file'
      ? join(options.directory, randomUUID())
      : undefined
  const sink = diskPath
    ? createWriteStream(diskPath, { flags: 'wx', mode: 0o600 })
    : new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      })
  await pipeline(stream, measure, sink, { signal: options.signal })
  if (
    (!unknownSize && bytes !== entry.size) ||
    (expectedCrc !== undefined && checksum !== expectedCrc)
  )
    throw new ArchiveError(
      'Archive integrity verification failed. The file may be damaged.'
    )
  if (diskPath) entry.diskPath = diskPath
  if (unknownSize) entry.size = bytes
}

/** Read sequentially and validate all content; never trust only the archive index. */
export async function readArchive(
  localPath: string,
  name: string,
  options: { directory?: string; signal?: AbortSignal } = {}
): Promise<ArchiveManifest> {
  options.signal?.throwIfAborted()
  const inputSize = (await stat(localPath)).size
  if (inputSize > ARCHIVE_LIMITS.archiveBytes)
    throw new ArchiveError('Archive files can be at most 256 MiB.', 413)
  const format = detectArchiveFormat(name)
  if (!format)
    throw new ArchiveError(
      'Use ZIP, TAR, TAR.GZ, TGZ, or GZIP. RAR, 7z, and encrypted archives are not supported.',
      415
    )
  const builder = new ManifestBuilder()
  try {
    if (format === 'zip') {
      const zip = await openPromise(localPath, {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      })
      const abort = () => zip.close()
      options.signal?.addEventListener('abort', abort, { once: true })
      try {
        if (zip.entryCount > ARCHIVE_LIMITS.entries)
          throw new ArchiveError(
            'Archives can contain at most 1,000 entries.',
            413
          )
        for await (const item of zip.eachEntry()) {
          options.signal?.throwIfAborted()
          if (item.generalPurposeBitFlag & 0x41)
            throw new ArchiveError(
              'Encrypted archives are not supported. Decrypt the archive before uploading it.',
              415
            )
          if (![0, 8].includes(item.compressionMethod))
            throw new ArchiveError(
              'This ZIP compression method is not supported. Use stored or deflated ZIP entries.',
              415
            )
          const unixType = (item.externalFileAttributes >>> 16) & 0o170000
          if (unixType && unixType !== 0o100000 && unixType !== 0o040000)
            throw new ArchiveError(
              'Archives containing symbolic links or special files are not supported.'
            )
          const directory =
            item.fileName.endsWith('/') ||
            unixType === 0o040000 ||
            !!(item.externalFileAttributes & 0x10)
          const entry = builder.add(
            item.fileName,
            directory ? 'directory' : 'file',
            item.uncompressedSize
          )
          if (!entry) continue
          const stream = await zip.openReadStreamPromise(item)
          await consume(stream, entry, options, item.crc32)
        }
      } finally {
        options.signal?.removeEventListener('abort', abort)
        zip.close()
      }
    } else if (format === 'gzip') {
      const entry = builder.add(archiveBasename(name), 'file', 0)!
      const gunzip = createGunzip()
      const feeding = pipeline(createReadStream(localPath), gunzip, {
        signal: options.signal,
      })
      void feeding.catch(() => {})
      try {
        await consume(gunzip, entry, options, undefined, true)
        await feeding
        builder.totalBytes = entry.size
      } finally {
        gunzip.destroy()
        await feeding.catch(() => {})
      }
    } else {
      if (format === 'tar' && inputSize < 512)
        throw new ArchiveError('The TAR archive is incomplete.')
      const extractor = tar.extract()
      const source = createReadStream(localPath)
      let tail = Buffer.alloc(0)
      const trailer = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          tail =
            chunk.length >= 1024
              ? Buffer.from(chunk.subarray(chunk.length - 1024))
              : Buffer.concat([tail, chunk]).subarray(-1024)
          callback(null, chunk)
        },
      })
      // Includes TAR padding/PAX data in the expansion budget; prevents padding bombs.
      const budget = byteLimit(
        ARCHIVE_LIMITS.expandedBytes + 16 * 1024 ** 2,
        'Expanded TAR stream exceeds its processing limit.'
      )
      const feeding =
        format === 'tar.gz'
          ? pipeline(source, createGunzip(), budget, trailer, extractor, {
              signal: options.signal,
            })
          : pipeline(source, budget, trailer, extractor, {
              signal: options.signal,
            })
      void feeding.catch(() => {})
      try {
        for await (const stream of extractor) {
          const header = stream.header
          if (header.type !== 'file' && header.type !== 'directory')
            throw new ArchiveError(
              'Archives containing links or special files are not supported.'
            )
          if (Object.keys(header.pax ?? {}).some((key) => /sparse/i.test(key)))
            throw new ArchiveError('Sparse TAR files are not supported.', 415)
          const entry = builder.add(header.name, header.type, header.size ?? 0)
          if (entry) await consume(Readable.from(stream), entry, options)
          else
            for await (const _chunk of stream) {
              /* Drain the conventional root entry. */
            }
        }
        await feeding
        if (tail.length !== 1024 || tail.some((byte) => byte !== 0))
          throw new ArchiveError(
            'The TAR archive is incomplete: its end marker is missing.'
          )
      } finally {
        extractor.destroy()
        await feeding.catch(() => {})
      }
    }
    options.signal?.throwIfAborted()
    return {
      format,
      entries: builder.entries,
      totalBytes: builder.totalBytes,
      fileCount: builder.fileCount,
    }
  } catch (error) {
    if (error instanceof ArchiveError || options.signal?.aborted) throw error
    throw new ArchiveError(
      'The archive is damaged, incomplete, encrypted, or uses an unsupported format.'
    )
  }
}

export async function createArchive(
  outputPath: string,
  format: ArchiveOutputFormat,
  entries: { path: string; localPath: string; size: number }[],
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  if (!entries.length || entries.length > ARCHIVE_LIMITS.selectedFiles)
    throw new ArchiveError('Select between 1 and 100 files.')
  const builder = new ManifestBuilder()
  for (const item of entries) builder.add(item.path, 'file', item.size)
  const archive =
    format === 'zip'
      ? archiver('zip', { zlib: { level: 6 } })
      : archiver('tar', { gzip: true, gzipOptions: { level: 6 } })
  const sink = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })
  const writing = pipeline(
    archive,
    byteLimit(
      ARCHIVE_LIMITS.archiveBytes,
      'The generated archive exceeds 256 MiB.'
    ),
    sink,
    { signal }
  )
  void writing.catch(() => {})
  // Never silently omit a source whose staged file disappeared.
  archive.on('warning', (error) => archive.destroy(error))
  try {
    for (let index = 0; index < entries.length; index++) {
      const item = entries[index]
      if ((await stat(item.localPath)).size !== item.size)
        throw new ArchiveError(
          'A source file changed while the archive was being created.',
          409
        )
      archive.file(item.localPath, {
        name: builder.entries[index].path,
        mode: 0o644,
      })
    }
    await archive.finalize()
    await writing
  } finally {
    archive.abort()
    archive.destroy()
    await writing.catch(() => {})
  }
}
