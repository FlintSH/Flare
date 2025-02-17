import { NextResponse } from 'next/server'

import archiver from 'archiver'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { clearProgress, getProgress, updateProgress } from '@/lib/utils'

// This whole file could probably be improved at some point. The way progress is tracked is kinda jank, but it works for now.

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

export async function GET() {
  let exportDir: string | null = null
  let totalFiles = 0
  let successfulFiles = 0
  let userId: string | null = null

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    userId = session.user.id

    // Initialize progress
    updateProgress(userId, 0)

    // Create temporary directory for export with timestamp
    const timestamp = Date.now()
    exportDir = join(process.cwd(), 'tmp', 'exports', `${userId}_${timestamp}`)
    await mkdir(exportDir, { recursive: true })

    // Get user data
    const user = await prisma.user.findUnique({
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

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Create user data JSON
    const userData: UserData = {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      files: user.files,
      shortenedUrls: user.shortenedUrls,
    }

    // Write user data to JSON file
    const userDataPath = join(exportDir, 'user-data.json')
    await writeFile(userDataPath, JSON.stringify(userData, null, 2))

    // Set up archive stream
    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    // Set up response headers
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

    // Create a transform stream to track download progress
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      },
    })

    // Create a readable stream that will contain our zip
    const stream = new ReadableStream({
      start(controller) {
        // Buffer to accumulate initial data for size estimation
        const initialChunks: Uint8Array[] = []
        let initialSize = 0
        let hasSetHeaders = false

        // Pipe archive data to the controller
        archive.on('data', (chunk) => {
          if (!hasSetHeaders && userId) {
            initialChunks.push(chunk)
            initialSize += chunk.length

            // after collecting enough data for size estimation
            if (initialSize > 1024 * 1024) {
              // estimate total size based on preparation progress
              const progress = getProgress(userId)
              if (progress > 0) {
                const estimatedTotalSize = Math.ceil(
                  initialSize * (100 / progress)
                )
                headers.set('Content-Length', estimatedTotalSize.toString())
              }

              // Enqueue all buffered chunks
              for (const bufferedChunk of initialChunks) {
                controller.enqueue(bufferedChunk)
              }
              hasSetHeaders = true
            }
          } else {
            controller.enqueue(chunk)
          }
        })

        archive.on('end', () => {
          controller.close()
        })

        archive.on('error', (error) => {
          controller.error(error)
          console.error('Archive error:', error)
        })

        // Add user data JSON to the archive
        archive.file(userDataPath, { name: 'user-data.json' })

        // Process files
        ;(async () => {
          try {
            totalFiles = user.files.length
            for (const file of user.files) {
              try {
                // Try both absolute and workspace-relative paths
                const absolutePath = join('/', file.path)
                const workspacePath = join(
                  process.cwd(),
                  'uploads',
                  file.path.split('uploads/')[1] || ''
                )

                let filePath = null
                if (existsSync(absolutePath)) {
                  filePath = absolutePath
                } else if (existsSync(workspacePath)) {
                  filePath = workspacePath
                } else {
                  console.error(`File not found: ${file.path}`)
                  continue
                }

                // Only proceed if we have a valid file path
                if (filePath) {
                  const zipPath = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}/${file.name}`
                  archive.file(filePath, { name: zipPath })
                  successfulFiles++

                  // Update progress
                  const progress = Math.round(
                    (successfulFiles / totalFiles) * 100
                  )
                  if (userId) {
                    updateProgress(userId, progress)
                  }
                }
              } catch (error) {
                console.error(
                  `Error adding file ${file.name} to archive:`,
                  error
                )
              }
            }

            // Finalize the archive
            archive.finalize()

            // Clean up the export folder after a delay
            setTimeout(async () => {
              try {
                if (exportDir) {
                  await rm(exportDir, { recursive: true })
                  console.log(
                    `Export cleanup completed. ${successfulFiles}/${totalFiles} files were exported successfully.`
                  )
                }
              } catch (error) {
                console.error('Error cleaning up export directory:', error)
              }
            }, 1000)
          } catch (error) {
            controller.error(error)
          }
        })()
      },
    })

    // Return the streaming response
    return new Response(stream.pipeThrough(transformStream), { headers })
  } catch (error) {
    // Clean up on error
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
