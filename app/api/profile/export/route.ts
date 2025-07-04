import { NextResponse } from 'next/server'

import archiver from 'archiver'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'
import type { StorageProvider } from '@/lib/storage'
import { clearProgress, updateProgress } from '@/lib/utils'

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
      console.log('Using S3 storage provider for file exports')
    } else {
      console.log('Using local storage provider for file exports')
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
        console.warn('Archive warning:', err)
      } else {
        console.error('Archive error:', err)
      }
    })

    archive.on('error', (err) => {
      console.error('Archive error:', err)
    })

    const writer = writable.getWriter()

    archive.on('data', async (chunk) => {
      await writer.write(chunk)
    })

    archive.on('end', async () => {
      try {
        await writer.close()
      } catch (err) {
        console.error('Error closing writer:', err)
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
                console.error(
                  `Error downloading file from S3: ${file.path}`,
                  downloadErr
                )
                console.error(`Skipping file: ${file.name} (${file.path})`)
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
                console.error(`File not found: ${file.path}`)
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
                console.error(
                  `Error adding file to archive: ${file.name}`,
                  archiveErr
                )
              }

              if (isS3Storage && filePath.startsWith(exportDir)) {
                try {
                  await rm(filePath)
                } catch (cleanupErr) {
                  console.error(
                    `Error cleaning up temp file: ${filePath}`,
                    cleanupErr
                  )
                }
              }
            }
          } catch (error) {
            console.error(`Error adding file ${file.name} to archive:`, error)
          }
        }

        try {
          await archive.finalize()
        } catch (error) {
          console.error('Error finalizing archive:', error)
        }

        setTimeout(async () => {
          try {
            if (exportDir) {
              await rm(exportDir, { recursive: true })
              console.log(
                `Export cleanup completed. ${successfulFiles}/${totalFiles} files were exported successfully.`
              )
            }
          } catch (cleanupError) {
            console.error('Error cleaning up export directory:', cleanupError)
          }
        }, 5000)
      } catch (error) {
        console.error('File processing error:', error)
        try {
          await writer.close()
        } catch (closeErr) {
          console.error('Error closing writer after error:', closeErr)
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
        console.error('Error cleaning up export directory:', cleanupError)
      }
    }

    console.error('Data export error:', error)
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
    console.error(`Failed to retrieve file from storage: ${filePath}`, error)
    throw error
  }
}
