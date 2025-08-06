import { CompressionSettings } from '@prisma/client'
import { exec } from 'child_process'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'

import { getStorageProvider } from '@/lib/storage'

const execAsync = promisify(exec)

export interface CompressionOptions {
  settings: CompressionSettings
  inputPath: string
  outputPath?: string
  mimeType: string
  keepOriginal?: boolean
}

export interface CompressionResult {
  success: boolean
  outputPath?: string
  originalSize: number
  compressedSize?: number
  compressionRatio?: number
  error?: string
}

export class CompressionService {
  private static readonly SUPPORTED_IMAGE_FORMATS = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
    'image/bmp',
  ]

  private static readonly SUPPORTED_VIDEO_FORMATS = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/mpeg',
  ]

  static async compressFile(
    options: CompressionOptions
  ): Promise<CompressionResult> {
    const { settings, inputPath, mimeType } = options

    if (!settings.enabled || !settings.autoCompress) {
      return {
        success: false,
        originalSize: 0,
        error: 'Compression is disabled',
      }
    }

    // Download file from storage to temp directory for processing
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-compress-'))
    const tempInputPath = path.join(tempDir, path.basename(inputPath))

    try {
      const storageProvider = await getStorageProvider()

      // Get file size from storage
      const originalSize = await storageProvider.getFileSize(inputPath)

      if (
        settings.compressionThreshold &&
        originalSize < settings.compressionThreshold
      ) {
        await fs.rmdir(tempDir, { recursive: true })
        return {
          success: false,
          originalSize,
          error: 'File size below compression threshold',
        }
      }

      // Download file to temp location
      const fileStream = await storageProvider.getFileStream(inputPath)
      const writeStream = createWriteStream(tempInputPath)
      await pipeline(fileStream, writeStream)

      // Process compression based on file type
      let result: CompressionResult

      if (
        this.SUPPORTED_IMAGE_FORMATS.includes(mimeType) &&
        settings.imageCompression
      ) {
        result = await this.compressImage({
          ...options,
          inputPath: tempInputPath,
        })
      } else if (
        this.SUPPORTED_VIDEO_FORMATS.includes(mimeType) &&
        settings.videoCompression
      ) {
        result = await this.compressVideo({
          ...options,
          inputPath: tempInputPath,
        })
      } else {
        await fs.rmdir(tempDir, { recursive: true })
        return {
          success: false,
          originalSize,
          error: 'Unsupported file format for compression',
        }
      }

      // If compression was successful, upload the compressed file back to storage
      if (result.success && result.outputPath) {
        const compressedBuffer = await fs.readFile(result.outputPath)

        if (settings.keepOriginal) {
          // Save original with _original suffix
          const ext = path.extname(inputPath)
          const baseName = path.basename(inputPath, ext)
          const dir = path.dirname(inputPath)
          const originalBackupPath = path.join(
            dir,
            `${baseName}_original${ext}`
          )

          // Move original to backup location
          const originalStream = await storageProvider.getFileStream(inputPath)
          const originalBuffer = await streamToBuffer(originalStream)
          await storageProvider.uploadFile(
            originalBuffer,
            originalBackupPath,
            mimeType
          )
        }

        // Upload compressed file to original location
        await storageProvider.uploadFile(compressedBuffer, inputPath, mimeType)

        result.outputPath = inputPath
      }

      // Clean up temp directory
      await fs.rmdir(tempDir, { recursive: true })

      return result
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rmdir(tempDir, { recursive: true })
      } catch {}

      throw error
    }
  }

  private static async compressImage(
    options: CompressionOptions
  ): Promise<CompressionResult> {
    const { settings, inputPath } = options
    const fileStats = await fs.stat(inputPath)
    const originalSize = fileStats.size

    try {
      const ext = path.extname(inputPath)
      const baseName = path.basename(inputPath, ext)
      const dir = path.dirname(inputPath)

      const compressedPath = path.join(dir, `${baseName}_compressed${ext}`)
      const tempPath = `${compressedPath}.tmp`

      let pipeline = sharp(inputPath)

      if (settings.maxWidth || settings.maxHeight) {
        pipeline = pipeline.resize(
          settings.maxWidth || undefined,
          settings.maxHeight || undefined,
          {
            fit: 'inside',
            withoutEnlargement: true,
          }
        )
      }

      const format = settings.imageFormat || 'auto'
      const quality = Math.max(1, Math.min(100, settings.imageQuality || 85))

      switch (format) {
        case 'webp':
          pipeline = pipeline.webp({ quality })
          break
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({ quality, progressive: true })
          break
        case 'png':
          pipeline = pipeline.png({ quality, compressionLevel: 9 })
          break
        case 'auto':
        default:
          const inputFormat = (await sharp(inputPath).metadata()).format
          if (
            inputFormat === 'png' &&
            (await this.hasTransparency(inputPath))
          ) {
            pipeline = pipeline.png({ quality, compressionLevel: 9 })
          } else {
            pipeline = pipeline.jpeg({ quality, progressive: true })
          }
          break
      }

      await pipeline.toFile(tempPath)

      const compressedStats = await fs.stat(tempPath)
      const compressedSize = compressedStats.size

      if (compressedSize >= originalSize) {
        await fs.unlink(tempPath)
        return {
          success: false,
          originalSize,
          error: 'Compressed file is larger than original',
        }
      }

      // Return the temp path for upload
      return {
        success: true,
        outputPath: tempPath,
        originalSize,
        compressedSize,
        compressionRatio: Number(
          ((1 - compressedSize / originalSize) * 100).toFixed(2)
        ),
      }
    } catch (error) {
      return {
        success: false,
        originalSize,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error during image compression',
      }
    }
  }

  private static async compressVideo(
    options: CompressionOptions
  ): Promise<CompressionResult> {
    const { settings, inputPath } = options
    const fileStats = await fs.stat(inputPath)
    const originalSize = fileStats.size

    try {
      const ffmpegAvailable = await this.checkFFmpegAvailable()
      if (!ffmpegAvailable) {
        return {
          success: false,
          originalSize,
          error:
            'FFmpeg is not installed on the server. Video compression is unavailable.',
        }
      }

      const ext = path.extname(inputPath)
      const baseName = path.basename(inputPath, ext)
      const dir = path.dirname(inputPath)

      const compressedPath = path.join(dir, `${baseName}_compressed.mp4`)
      const tempPath = `${compressedPath}.tmp`

      const quality = Math.max(1, Math.min(100, settings.videoQuality || 80))
      const crf = Math.round(51 - quality * 0.51)

      let ffmpegCommand = `ffmpeg -i "${inputPath}" -c:v ${settings.videoCodec || 'libx264'} -crf ${crf} -preset medium -movflags +faststart`

      if (settings.videoBitrate) {
        ffmpegCommand += ` -b:v ${settings.videoBitrate}`
      }

      if (settings.maxWidth || settings.maxHeight) {
        const width = settings.maxWidth || -2
        const height = settings.maxHeight || -2
        ffmpegCommand += ` -vf scale=${width}:${height}`
      }

      ffmpegCommand += ` -y "${tempPath}"`

      await execAsync(ffmpegCommand)

      const compressedStats = await fs.stat(tempPath)
      const compressedSize = compressedStats.size

      if (compressedSize >= originalSize) {
        await fs.unlink(tempPath)
        return {
          success: false,
          originalSize,
          error: 'Compressed file is larger than original',
        }
      }

      // Return the temp path for upload
      return {
        success: true,
        outputPath: tempPath,
        originalSize,
        compressedSize,
        compressionRatio: Number(
          ((1 - compressedSize / originalSize) * 100).toFixed(2)
        ),
      }
    } catch (error) {
      return {
        success: false,
        originalSize,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error during video compression',
      }
    }
  }

  private static async checkFFmpegAvailable(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version')
      return true
    } catch {
      return false
    }
  }

  private static async hasTransparency(imagePath: string): Promise<boolean> {
    try {
      const metadata = await sharp(imagePath).metadata()
      return metadata.channels === 4
    } catch {
      return false
    }
  }

  static async getDefaultSettings(
    isAdmin: boolean = false
  ): Promise<Partial<CompressionSettings>> {
    return {
      enabled: false,
      imageCompression: true,
      imageQuality: isAdmin ? 90 : 85,
      imageFormat: 'auto',
      videoCompression: true,
      videoQuality: isAdmin ? 85 : 80,
      videoCodec: 'libx264',
      keepOriginal: true,
      autoCompress: true,
      compressionThreshold: 1048576, // 1MB
    }
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
