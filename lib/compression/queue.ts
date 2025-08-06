import { prisma } from '@/lib/database/prisma'
import { eventEmitter } from '@/lib/events/emitter'

import { CompressionService } from './index'

export interface CompressionJob {
  fileId: string
  userId: string
  inputPath: string
  mimeType: string
}

export class CompressionQueue {
  private static instance: CompressionQueue
  private processing = false
  private queue: CompressionJob[] = []

  private constructor() {}

  static getInstance(): CompressionQueue {
    if (!this.instance) {
      this.instance = new CompressionQueue()
    }
    return this.instance
  }

  async addJob(job: CompressionJob): Promise<void> {
    this.queue.push(job)
    if (!this.processing) {
      this.processQueue()
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const job = this.queue.shift()
      if (job) {
        await this.processJob(job)
      }
    }

    this.processing = false
  }

  private async processJob(job: CompressionJob): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: job.userId },
        include: { compressionSettings: true },
      })

      if (!user) {
        console.error(`User not found: ${job.userId}`)
        return
      }

      let settings = user.compressionSettings
      if (!settings) {
        const defaultSettings = await CompressionService.getDefaultSettings(
          user.role === 'ADMIN'
        )
        settings = await prisma.compressionSettings.create({
          data: {
            userId: user.id,
            enabled: defaultSettings.enabled ?? false,
            imageCompression: defaultSettings.imageCompression ?? true,
            imageQuality: defaultSettings.imageQuality ?? 85,
            imageFormat: defaultSettings.imageFormat ?? null,
            videoCompression: defaultSettings.videoCompression ?? true,
            videoQuality: defaultSettings.videoQuality ?? 80,
            videoBitrate: defaultSettings.videoBitrate ?? null,
            videoCodec: defaultSettings.videoCodec ?? null,
            maxWidth: defaultSettings.maxWidth ?? null,
            maxHeight: defaultSettings.maxHeight ?? null,
            keepOriginal: defaultSettings.keepOriginal ?? true,
            autoCompress: defaultSettings.autoCompress ?? true,
            compressionThreshold:
              defaultSettings.compressionThreshold ?? 1048576,
          },
        })
      }

      const result = await CompressionService.compressFile({
        settings,
        inputPath: job.inputPath,
        mimeType: job.mimeType,
        keepOriginal: settings.keepOriginal,
      })

      if (result.success) {
        await prisma.file.update({
          where: { id: job.fileId },
          data: {
            size: result.compressedSize!,
            originalSize: result.originalSize,
            isCompressed: true,
            compressionRatio: result.compressionRatio,
            originalPath: settings.keepOriginal
              ? `${job.inputPath}.original`
              : null,
          },
        })

        const savedSpace = result.originalSize - result.compressedSize!
        await prisma.user.update({
          where: { id: job.userId },
          data: {
            storageUsed: {
              decrement: savedSpace,
            },
          },
        })

        await eventEmitter.emit('file.compressed', {
          fileId: job.fileId,
          userId: job.userId,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize!,
          compressionRatio: result.compressionRatio!,
        })
      }
    } catch (error) {
      console.error('Compression job failed:', error)
      await eventEmitter.emit('file.compression.failed', {
        fileId: job.fileId,
        userId: job.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

export const compressionQueue = CompressionQueue.getInstance()
