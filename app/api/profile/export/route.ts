import { NextResponse } from 'next/server'

import archiver from 'archiver'
import { once } from 'node:events'
import { ReadStream, createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { sanitizeDisplayName } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import type { StorageProvider } from '@/lib/storage'
import { uploadDisplayName } from '@/lib/uploads/display-name'
import { clearProgress, updateProgress } from '@/lib/utils'

const logger = loggers.users

type FileData = {
  name: string
  mimeType: string
  size: number
  visibility: 'PUBLIC' | 'PRIVATE'
  uploadedAt: Date
  isOcrProcessed: boolean
  ocrText: string | null
  isPaste: boolean
  path: string
}

type ShortenedUrlData = {
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: Date
}

type UserData = {
  id: string
  name: string | null
  email: string | null
  createdAt: Date
  updatedAt: Date
  files: FileData[]
  shortenedUrls: ShortenedUrlData[]
}

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * Gives each file its own entry. Extraction on Windows and macOS is
 * case-insensitive, so `Report.PDF` and `report.pdf` also count as a clash.
 */
function entryNames() {
  const used = new Set<string>()
  return (file: Pick<FileData, 'name' | 'uploadedAt'>) => {
    const folder = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}`
    // Older chunked uploads could save a path as the name; keep its last part.
    const name = sanitizeDisplayName(uploadDisplayName(file.name) ?? '')
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    for (let copy = 1; ; copy++) {
      const entry = `${folder}/${copy === 1 ? name : `${stem} (${copy})${extension}`}`
      if (!used.has(entry.toLowerCase())) {
        used.add(entry.toLowerCase())
        return entry
      }
    }
  }
}

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
  file: FileData,
  signal: AbortSignal
): Promise<Readable> {
  if (storageProvider.kind === 's3')
    return storageProvider.getFileStream(file.path, undefined, signal)
  const path = localFilePath(file.path)
  if (!path) throw new Error(`File not found: ${file.path}`)
  const stream = createReadStream(path, { signal })
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
  userId: string,
  userData: UserData,
  storageProvider: StorageProvider
) {
  const archive = archiver('zip', {
    zlib: { level: 9 },
  })
  const abort = new AbortController()
  let source: Readable | null = null
  let settled = false
  let written = 0
  const total = userData.files.length

  // Runs once: after a cancelled download, a storage or archive failure, or
  // when the archive has been read to the end.
  const settle = (error?: Error) => {
    if (settled) return
    settled = true
    if (!error && archive.readableEnded) {
      updateProgress(userId, 100)
      return
    }
    if (!error) logger.info('Data export download ended before it finished')
    // Close the open file before aborting, so a cancelled download is not
    // also reported as a storage stream error.
    source?.destroy()
    abort.abort(error ?? new Error('The export download was cancelled'))
    archive.abort()
    // Errors the response so the client sees a failed download, never a
    // silently truncated archive.
    if (error) archive.destroy(error)
    clearProgress(userId)
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
    if (!entry.name.startsWith('files/')) return
    written++
    updateProgress(userId, Math.min(99, Math.floor((written / total) * 100)))
  })
  // `close` after `end` is a finished download; without `end`, the reader
  // went away or the archive failed.
  archive.on('close', () => settle())

  archive.append(JSON.stringify(userData, null, 2), {
    name: 'user-data.json',
  })

  const nextEntryName = entryNames()
  void (async () => {
    for (const file of userData.files) {
      if (abort.signal.aborted) return
      const name = nextEntryName(file)
      let opened: Readable
      try {
        opened = await openFile(storageProvider, file, abort.signal)
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
      // Open the next file only after archiver has read this one.
      await finished(opened)
      source = null
    }
    if (!abort.signal.aborted) await archive.finalize()
  })().catch((error) => {
    if (!abort.signal.aborted) settle(error as Error)
  })

  return archive
}

async function handleGET(req: Request) {
  let userId: string | null = null

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    userId = user.id

    const userData = await prisma.user.findUnique({
      where: { id: userId },
      select: {
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
      },
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const storageProvider = await getStorageProvider()
    logger.info(`Using ${storageProvider.kind} storage for a data export`)
    updateProgress(userId, 0)

    const userDataForExport: UserData = {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      files: userData.files,
      shortenedUrls: userData.shortenedUrls,
    }

    const timestamp = Date.now()
    const headers = new Headers()
    headers.set('Content-Type', 'application/zip')
    headers.set(
      'Content-Disposition',
      `attachment; filename="flare-data-export-${timestamp}.zip"`
    )
    headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    )

    const archive = exportArchive(userId, userDataForExport, storageProvider)
    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
      headers,
    })
  } catch (error) {
    if (userId) {
      clearProgress(userId)
    }

    logger.error('Data export error:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return withAuditRoute(async () => handleGET(req), {
    route: '/api/profile/export',
  })(req)
}
