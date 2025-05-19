/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'

import archiver from 'archiver'
import { createReadStream, existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { clearProgress, updateProgress } from '@/lib/utils'

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

export async function GET(req: Request) {
  let exportDir: string | null = null
  let totalFiles = 0
  let successfulFiles = 0
  let userId: string | null = null

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    userId = user.id

    // Initialize progress
    updateProgress(userId, 0)

    // Create temporary directory for export with timestamp
    const timestamp = Date.now()
    exportDir = join(process.cwd(), 'tmp', 'exports', `${userId}_${timestamp}`)
    await mkdir(exportDir, { recursive: true })

    // Get user data
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

    // Create user data JSON
    const userDataForExport: UserData = {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      files: userData.files,
      shortenedUrls: userData.shortenedUrls,
    }

    // Write user data to JSON file
    if (!exportDir) {
      throw new Error('Export directory is not defined')
    }

    const userDataPath = join(exportDir, 'user-data.json')
    await writeFile(userDataPath, JSON.stringify(userDataForExport, null, 2))

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

    // Create a transform stream for tracking download progress
    const { readable, writable } = new TransformStream()

    // Set up archive stream
    const archive = archiver('zip', {
      zlib: { level: 9 },
    }) as any // Cast to any to avoid TypeScript errors

    // Handle archive warnings and errors for better debugging
    archive.on('warning', (err: any) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning:', err)
      } else {
        console.error('Archive error:', err)
      }
    })

    archive.on('error', (err: Error) => {
      console.error('Archive error:', err)
    })

    // Pipe archive data to the writable stream
    const writer = writable.getWriter()

    // Handle archive data
    archive.on('data', async (chunk: Uint8Array) => {
      await writer.write(chunk)
    })

    // Close the writable stream when the archive is done
    archive.on('end', async () => {
      try {
        await writer.close()
      } catch (err: any) {
        console.error('Error closing writer:', err)
      }
    })

    // Add user data JSON to the archive
    archive.append(createReadStream(userDataPath), { name: 'user-data.json' })(
      // Process files asynchronously
      async () => {
        try {
          totalFiles = userData.files.length

          if (userId) {
            updateProgress(userId, 0)
          }

          // If there are no files, make sure we still finalize the archive
          if (totalFiles === 0) {
            console.log('No files to export for user', userId)
            archive.finalize()
            return
          }

          console.log(
            `Starting export of ${totalFiles} files for user ${userId}`
          )

          // Create a directory for files in the export
          if (!exportDir) {
            throw new Error('Export directory is not defined')
          }

          const filesDir = join(exportDir, 'files')
          await mkdir(filesDir, { recursive: true })

          for (const file of userData.files) {
            try {
              // Log the raw file path from database
              console.log(
                `Processing file: ${file.name}, Path from DB: ${file.path}`
              )

              // Try multiple path resolution strategies
              const possiblePaths = []

              // 1. Try the path directly as stored in DB
              possiblePaths.push(file.path)

              // 2. Try with absolute path
              possiblePaths.push(join('/', file.path))

              // 3. Try relative to workspace/uploads directory
              if (file.path.includes('uploads/')) {
                possiblePaths.push(
                  join(
                    process.cwd(),
                    'uploads',
                    file.path.split('uploads/')[1] || ''
                  )
                )
              } else {
                possiblePaths.push(join(process.cwd(), 'uploads', file.path))
              }

              // 4. Try with just the filename
              possiblePaths.push(join(process.cwd(), 'uploads', file.name))

              // 5. Try S3 path format if applicable
              if (file.path.startsWith('s3://')) {
                const s3Path = file.path.replace('s3://', '')
                possiblePaths.push(join(process.cwd(), 'uploads', s3Path))
              }

              // Try to find a valid file path
              let filePath = null
              for (const path of possiblePaths) {
                console.log(`Checking path: ${path}`)
                if (existsSync(path)) {
                  filePath = path
                  console.log(`Found file at: ${filePath}`)
                  break
                }
              }

              if (!filePath) {
                // If file doesn't exist physically, create a placeholder
                console.log(
                  `File not found for: ${file.name}, creating placeholder`
                )
                const placeholderPath = join(filesDir, file.name)
                const fileInfo = JSON.stringify(
                  {
                    name: file.name,
                    size: file.size,
                    mimeType: file.mimeType,
                    uploadedAt: file.uploadedAt,
                    visibility: file.visibility,
                    path: file.path,
                    note: 'Original file could not be located on server',
                  },
                  null,
                  2
                )

                await writeFile(placeholderPath, fileInfo)
                filePath = placeholderPath
              }

              // Add file to archive - use append with createReadStream
              const zipPath = `files/${new Date(file.uploadedAt).toISOString().split('T')[0]}/${file.name}`
              archive.append(createReadStream(filePath), { name: zipPath })
              successfulFiles++

              // Update progress
              const progress = Math.round((successfulFiles / totalFiles) * 100)
              if (userId) {
                updateProgress(userId, progress)
              }
            } catch (error) {
              console.error(`Error adding file ${file.name} to archive:`, error)
            }
          }

          console.log(
            `Finalizing archive with ${successfulFiles}/${totalFiles} files`
          )

          // Finalize the archive when all files are processed
          try {
            await archive.finalize()
          } catch (error) {
            console.error('Error finalizing archive:', error)
          }

          // Clean up the export folder after a delay
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
      }
    )()

    // Return the streaming response
    return new Response(readable, { headers })
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
