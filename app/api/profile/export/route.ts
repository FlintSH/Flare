import { NextResponse } from 'next/server'

import archiver from 'archiver'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'
import type { StorageProvider } from '@/lib/storage'
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

export async function GET(req: Request) {
  let exportDir: string | null = null
  let totalFiles = 0
  let successfulFiles = 0
  let userId: string | null = null

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    userId = user.id

    updateProgress(userId, 0)

    const timestamp = Date.now()
    exportDir = join(process.cwd(), 'tmp', 'exports', `${userId}_${timestamp}`)
    await mkdir(exportDir, { recursive: true })

    const storageProvider = await getStorageProvider()
    const isS3Storage = storageProvider instanceof S3StorageProvider

    if (isS3Storage) {
      logger.info('Using S3 storage provider for file exports')
    } else {
      logger.info('Using local storage provider for file exports')
    }

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

    const userDataForExport: UserData = {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      files: userData.files,
      shortenedUrls: userData.shortenedUrls,
    }

    const userDataPath = join(exportDir, 'user-data.json')
    await writeFile(userDataPath, JSON.stringify(userDataForExport, null, 2))

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

    const { readable, writable } = new TransformStream()

    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        logger.warn('Archive warning', { error: err.message })
      } else {
        logger.error('Archive error', err as Error)
      }
    })

    archive.on('error', (err) => {
      logger.error('Archive error:', err as Error)
    })

    const writer = writable.getWriter()

    archive.on('data', async (chunk) => {
      await writer.write(chunk)
    })

    archive.on('end', async () => {
      try {
        await writer.close()
      } catch (err) {
        logger.error('Error closing writer:', err as Error)
      }
    })

    archive.file(userDataPath, { name: 'user-data.json' })
    ;(async () => {
      try {
        totalFiles = userData.files.length
        updateProgress(userId, 0)

        if (totalFiles === 0) {
          archive.finalize()
          return
        }

        for (const file of userData.files) {
          try {
            let fileData: Buffer | null = null
            let filePath: string | null = null

            if (isS3Storage) {
              try {
                fileData = await getFileContentFromStorage(
                  storageProvider,
                  file.path
                )

                filePath = join(exportDir, file.name)
                await writeFile(filePath, fileData)
              } catch (downloadErr) {
                logger.error(
                  `Error downloading file from S3: ${file.path}`,
                  downloadErr as Error
                )
                logger.info(`Skipping file: ${file.name} (${file.path})`)
                continue
              }
            } else {
              const absolutePath = join('/', file.path)
              const workspacePath = join(
                process.cwd(),
                'uploads',
                file.path.split('uploads/')[1] || ''
              )

              if (existsSync(absolutePath)) {
                filePath = absolutePath
              } else if (existsSync(workspacePath)) {
                filePath = workspacePath
              } else {
                logger.error(
                  'File not found',
                  new Error(`File not found: ${file.path}`)
                )
                continue
              }
            }

            if (filePath) {
              const zipPath = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}/${file.name}`
              try {
                archive.file(filePath, { name: zipPath })
                successfulFiles++

                const progress = Math.round(
                  (successfulFiles / totalFiles) * 100
                )
                if (userId) {
                  updateProgress(userId, progress)
                }
              } catch (archiveErr) {
                logger.error(
                  `Error adding file to archive: ${file.name}`,
                  archiveErr as Error
                )
              }

              if (isS3Storage && filePath.startsWith(exportDir)) {
                try {
                  await rm(filePath)
                } catch (cleanupErr) {
                  logger.debug(`Error cleaning up temp file: ${filePath}`, {
                    error: cleanupErr,
                  })
                }
              }
            }
          } catch (error) {
            logger.error(
              `Error adding file ${file.name} to archive:`,
              error as Error
            )
          }
        }

        try {
          await archive.finalize()
        } catch (error) {
          logger.error('Error finalizing archive:', error as Error)
        }

        setTimeout(async () => {
          try {
            if (exportDir) {
              await rm(exportDir, { recursive: true })
              logger.info(
                `Export cleanup completed. ${successfulFiles}/${totalFiles} files were exported successfully.`
              )
            }
          } catch (cleanupError) {
            logger.error(
              'Error cleaning up export directory:',
              cleanupError as Error
            )
          }
        }, 5000)
      } catch (error) {
        logger.error('File processing error:', error as Error)
        try {
          await writer.close()
        } catch (closeErr) {
          logger.error('Error closing writer after error:', closeErr as Error)
        }
      }
    })()

    return new Response(readable, { headers })
  } catch (error) {
    if (userId) {
      clearProgress(userId)
    }
    if (exportDir) {
      try {
        await rm(exportDir, { recursive: true })
      } catch (cleanupError) {
        logger.error(
          'Error cleaning up export directory:',
          cleanupError as Error
        )
      }
    }

    logger.error('Data export error:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function getFileContentFromStorage(
  storageProvider: StorageProvider,
  filePath: string
): Promise<Buffer> {
  try {
    const fileStream = await storageProvider.getFileStream(filePath)
    const chunks: Buffer[] = []

    for await (const chunk of fileStream) {
      chunks.push(Buffer.from(chunk))
    }

    return Buffer.concat(chunks)
  } catch (error) {
    logger.error(
      `Failed to retrieve file from storage: ${filePath}`,
      error as Error
    )
    throw error
  }
}
