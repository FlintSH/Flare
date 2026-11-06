import type { Prisma } from '@prisma/client'
import archiver from 'archiver'
import { once } from 'node:events'
import { ReadStream, createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

import { prisma } from '@/lib/database/prisma'
import { exportEntryNamer } from '@/lib/files/export-entry-names'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'

import { trackExport } from './export-progress'

const logger = loggers.users

// `user-data.json` is this record as selected, fields in this order.
const exportSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  files: {
    select: {
      name: true,
      mimeType: true,
      size: true,
      visibility: true,
      uploadedAt: true,
      isOcrProcessed: true,
      ocrText: true,
      isPaste: true,
      path: true,
    },
    // The oldest copy of a repeated name keeps the plain entry name.
    orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
  },
  shortenedUrls: {
    select: {
      shortCode: true,
      targetUrl: true,
      clicks: true,
      createdAt: true,
    },
  },
} satisfies Prisma.UserSelect

type ExportedAccount = Prisma.UserGetPayload<{ select: typeof exportSelect }>

// Local uploads predate the storage provider's path checks, so keep the
// original lookup: an absolute path first, then the app's uploads directory.
function localFilePath(path: string): string | null {
  const absolutePath = join('/', path)
  if (existsSync(absolutePath)) return absolutePath
  const workspacePath = join(
    process.cwd(),
    'uploads',
    path.split('uploads/')[1] || ''
  )
  return existsSync(workspacePath) ? workspacePath : null
}

async function openFile(
  storageProvider: StorageProvider,
  path: string,
  signal: AbortSignal
): Promise<Readable> {
  if (storageProvider.kind === 's3')
    return storageProvider.getFileStream(path, undefined, signal)
  const localPath = localFilePath(path)
  if (!localPath) throw new Error(`File not found: ${path}`)
  const stream = createReadStream(localPath, { signal })
  // Report a missing or unreadable file now, while it can still be skipped.
  if (stream instanceof ReadStream && stream.pending) {
    try {
      await once(stream, 'open', { signal })
    } catch (error) {
      stream.destroy()
      throw error
    }
  }
  return stream
}

/**
 * Streams the export as it is read. Files are opened one at a time when the
 * archive reaches them, so nothing is staged on disk or buffered whole, and a
 * slow download slows storage reads instead of filling memory.
 */
function exportArchive(
  account: ExportedAccount,
  storageProvider: StorageProvider,
  exportId: string | null,
  signal: AbortSignal
) {
  const archive = archiver('zip', {
    zlib: { level: 9 },
  })
  const progress = trackExport(account.id, exportId, account.files.length)
  const abort = new AbortController()
  let source: Readable | null = null
  let settled = false

  const settle = (error?: Error) => {
    if (settled) return
    settled = true
    if (!error && archive.readableEnded) return progress.finished()
    if (!error) logger.info('Data export download ended before it finished')
    // Close the open file before aborting, so a cancelled download is not
    // also reported as a storage stream error.
    source?.destroy()
    abort.abort(error ?? new Error('The export download was cancelled'))
    archive.abort()
    // Errors the response so the client sees a failed download, never a
    // silently truncated archive.
    if (error) archive.destroy(error)
    progress.failed()
  }

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      logger.warn('Archive warning', { error: err.message })
    } else {
      logger.error('Archive error', err as Error)
    }
  })
  archive.on('error', (err) => {
    if (settled) return
    // Next.js cancels the body with ResponseAborted when the client leaves.
    if (err.name === 'AbortError' || err.name === 'ResponseAborted')
      return settle()
    logger.error('Data export failed:', err as Error)
    settle(err)
  })
  archive.on('entry', (entry) => {
    if (entry.name.startsWith('files/')) progress.entryWritten()
  })
  // `close` after `end` is a finished download; without `end`, the reader
  // went away or the archive failed.
  archive.on('close', () => settle())
  // A client that leaves before the response starts, as a reload can, never
  // reads or cancels the body. The request signal still reports it.
  if (signal.aborted) settle()
  else signal.addEventListener('abort', () => settle(), { once: true })

  archive.append(JSON.stringify(account, null, 2), {
    name: 'user-data.json',
  })

  const nextEntryName = exportEntryNamer()
  void (async () => {
    for (const file of account.files) {
      if (abort.signal.aborted) return
      const name = nextEntryName(file)
      let opened: Readable
      try {
        opened = await openFile(storageProvider, file.path, abort.signal)
      } catch (error) {
        if (abort.signal.aborted) return
        logger.error(
          `Skipping a file storage could not open: ${file.path}`,
          error as Error
        )
        continue
      }
      if (abort.signal.aborted) {
        opened.destroy()
        return
      }
      source = opened
      // archiver reads sources through its own PassThrough and never sees
      // their errors. A file that fails part-way fails the whole download.
      opened.on('error', (error) => {
        if (source === opened) settle(error)
      })
      archive.append(opened, { name, date: new Date(file.uploadedAt) })
      await finished(opened)
      source = null
    }
    if (!abort.signal.aborted) await archive.finalize()
  })().catch((error) => {
    if (!abort.signal.aborted) settle(error as Error)
  })

  return archive
}

/**
 * The account's data export: `user-data.json` and its stored files in one
 * ZIP, built while the body is read. `exportId` lets the browser that started
 * it follow its progress; `signal` is the request's, so a client that leaves
 * stops the export.
 */
export async function exportAccountData(
  userId: string,
  { exportId, signal }: { exportId: string | null; signal: AbortSignal }
): Promise<{ filename: string; body: ReadableStream<Uint8Array> }> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: exportSelect,
  })
  if (!account) throw new HttpError(404, 'User not found')

  const storageProvider = await getStorageProvider()
  logger.info(`Using ${storageProvider.kind} storage for a data export`)
  const filename = `flare-data-export-${Date.now()}.zip`
  const archive = exportArchive(account, storageProvider, exportId, signal)
  return {
    filename,
    body: Readable.toWeb(archive) as ReadableStream<Uint8Array>,
  }
}
