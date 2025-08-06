import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { CompressionSettings } from '@prisma/client'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

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
        originalSize: (await fs.stat(inputPath)).size,
        error: 'Compression is disabled',
      }
    }

    const fileStats = await fs.stat(inputPath)
    const originalSize = fileStats.size

    if (
      settings.compressionThreshold &&
      originalSize < settings.compressionThreshold
    ) {
      return {
        success: false,
        originalSize,
        error: 'File size below compression threshold',
      }
    }

    if (
      this.SUPPORTED_IMAGE_FORMATS.includes(mimeType) &&
      settings.imageCompression
    ) {
      return this.compressImage(options)
    }

    if (
      this.SUPPORTED_VIDEO_FORMATS.includes(mimeType) &&
      settings.videoCompression
    ) {
      return this.compressVideo(options)
    }

    return {
      success: false,
      originalSize,
      error: 'Unsupported file format for compression',
    }
  }

  private static async compressImage(
    options: CompressionOptions
  ): Promise<CompressionResult> {
    const { settings, inputPath, outputPath, keepOriginal } = options
    const fileStats = await fs.stat(inputPath)
    const originalSize = fileStats.size

    try {
      const ext = path.extname(inputPath)
      const baseName = path.basename(inputPath, ext)
      const dir = path.dirname(inputPath)

      const compressedPath =
        outputPath || path.join(dir, `${baseName}_compressed${ext}`)
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

      if (keepOriginal) {
        const originalBackupPath = path.join(dir, `${baseName}_original${ext}`)
        await fs.rename(inputPath, originalBackupPath)
        await fs.rename(tempPath, inputPath)

        return {
          success: true,
          outputPath: inputPath,
          originalSize,
          compressedSize,
          compressionRatio: Number(
            ((1 - compressedSize / originalSize) * 100).toFixed(2)
          ),
        }
      } else {
        await fs.rename(tempPath, compressedPath)
        if (compressedPath !== inputPath) {
          await fs.unlink(inputPath)
        }

        return {
          success: true,
          outputPath: compressedPath,
          originalSize,
          compressedSize,
          compressionRatio: Number(
            ((1 - compressedSize / originalSize) * 100).toFixed(2)
          ),
        }
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
    const { settings, inputPath, outputPath, keepOriginal } = options
    const fileStats = await fs.stat(inputPath)
    const originalSize = fileStats.size

    return new Promise((resolve) => {
      try {
        const ext = path.extname(inputPath)
        const baseName = path.basename(inputPath, ext)
        const dir = path.dirname(inputPath)

        const compressedPath =
          outputPath || path.join(dir, `${baseName}_compressed.mp4`)
        const tempPath = `${compressedPath}.tmp`

        const quality = Math.max(1, Math.min(100, settings.videoQuality || 80))
        const crf = Math.round(51 - quality * 0.51)

        let command = ffmpeg(inputPath)
          .videoCodec(settings.videoCodec || 'libx264')
          .outputOptions([
            `-crf ${crf}`,
            '-preset medium',
            '-movflags +faststart',
          ])

        if (settings.videoBitrate) {
          command = command.videoBitrate(settings.videoBitrate)
        }

        if (settings.maxWidth || settings.maxHeight) {
          const width = settings.maxWidth || -2
          const height = settings.maxHeight || -2
          command = command.size(`${width}x${height}`)
        }

        command
          .on('end', async () => {
            try {
              const compressedStats = await fs.stat(tempPath)
              const compressedSize = compressedStats.size

              if (compressedSize >= originalSize) {
                await fs.unlink(tempPath)
                resolve({
                  success: false,
                  originalSize,
                  error: 'Compressed file is larger than original',
                })
                return
              }

              if (keepOriginal) {
                const originalBackupPath = path.join(
                  dir,
                  `${baseName}_original${ext}`
                )
                await fs.rename(inputPath, originalBackupPath)
                await fs.rename(tempPath, inputPath)

                resolve({
                  success: true,
                  outputPath: inputPath,
                  originalSize,
                  compressedSize,
                  compressionRatio: Number(
                    ((1 - compressedSize / originalSize) * 100).toFixed(2)
                  ),
                })
              } else {
                await fs.rename(tempPath, compressedPath)
                if (compressedPath !== inputPath) {
                  await fs.unlink(inputPath)
                }

                resolve({
                  success: true,
                  outputPath: compressedPath,
                  originalSize,
                  compressedSize,
                  compressionRatio: Number(
                    ((1 - compressedSize / originalSize) * 100).toFixed(2)
                  ),
                })
              }
            } catch (error) {
              resolve({
                success: false,
                originalSize,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Unknown error after video compression',
              })
            }
          })
          .on('error', (error) => {
            resolve({
              success: false,
              originalSize,
              error: error.message,
            })
          })
          .save(tempPath)
      } catch (error) {
        resolve({
          success: false,
          originalSize,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error during video compression',
        })
      }
    })
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
