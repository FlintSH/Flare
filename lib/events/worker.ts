import type { BaseEvent, EventWorkerOptions } from '@/types/events'
import { EventStatus } from '@/types/events'

import { loggers } from '@/lib/logger'

import { eventConsumer } from './consumer'
import { eventEmitter } from './emitter'

const logger = loggers.events.getChildLogger('worker')

interface WorkerStats {
  isRunning: boolean
  startedAt: Date | null
  eventsProcessed: number
  eventsSucceeded: number
  eventsFailed: number
  eventsRetried: number
  lastProcessedAt: Date | null
  avgProcessingTime: number
  currentBatch: number
}

export class EventWorker {
  private static instance: EventWorker | null = null
  private running = false
  private intervalId: NodeJS.Timeout | null = null
  private stats: WorkerStats = {
    isRunning: false,
    startedAt: null,
    eventsProcessed: 0,
    eventsSucceeded: 0,
    eventsFailed: 0,
    eventsRetried: 0,
    lastProcessedAt: null,
    avgProcessingTime: 0,
    currentBatch: 0,
  }
  private processingTimes: number[] = []

  private constructor() {}

  static getInstance(): EventWorker {
    if (!EventWorker.instance) {
      EventWorker.instance = new EventWorker()
    }
    return EventWorker.instance
  }

  async start(options: EventWorkerOptions = {}): Promise<void> {
    if (this.running) {
      logger.warn('Event worker is already running')
      return
    }

    const {
      batchSize = 10,
      pollInterval = 1000,
      maxConcurrency = 5,
      enableScheduledEvents = true,
    } = options

    this.running = true
    this.stats.isRunning = true
    this.stats.startedAt = new Date()

    logger.info('Starting event worker', {
      batchSize,
      pollInterval,
      maxConcurrency,
      enableScheduledEvents,
    })

    this.intervalId = setInterval(async () => {
      try {
        await this.processEvents(batchSize, maxConcurrency)

        if (enableScheduledEvents) {
          await this.activateScheduledEvents()
        }
      } catch (error) {
        logger.error('Error in event worker', error as Error)
      }
    }, pollInterval)

    logger.info('Event worker started successfully')
  }

  async stop(): Promise<void> {
    if (!this.running) {
      logger.warn('Event worker is not running')
      return
    }

    this.running = false
    this.stats.isRunning = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    logger.info('Event worker stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  getStats(): WorkerStats {
    return { ...this.stats }
  }

  private async processEvents(
    batchSize: number,
    _maxConcurrency: number
  ): Promise<void> {
    const events = await eventEmitter.getEvents({
      status: EventStatus.PENDING,
      limit: batchSize,
    })

    if (events.length === 0) {
      return
    }

    this.stats.currentBatch = events.length

    const processingPromises = events.map((event) =>
      this.processEventWithStats(event)
    )

    await Promise.all(processingPromises)
  }

  private async processEventWithStats(event: BaseEvent): Promise<void> {
    const startTime = Date.now()

    try {
      const result = await eventConsumer.processEvent(event)
      const processingTime = Date.now() - startTime

      this.updateProcessingTime(processingTime)
      this.stats.eventsProcessed++
      this.stats.lastProcessedAt = new Date()

      if (result.success) {
        this.stats.eventsSucceeded++
      } else {
        this.stats.eventsFailed++

        if (result.shouldRetry) {
          const retrySuccess = await eventConsumer.retryFailedEvent(event.id)
          if (retrySuccess) {
            this.stats.eventsRetried++
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to process event ${event.id}`, error as Error)
      this.stats.eventsFailed++
    }
  }

  private async activateScheduledEvents(): Promise<void> {
    try {
      const activatedCount = await eventEmitter.activateScheduledEvents()

      if (activatedCount > 0) {
        logger.debug(`Activated ${activatedCount} scheduled events`)
      }
    } catch (error) {
      logger.error('Error activating scheduled events', error as Error)
    }
  }

  private updateProcessingTime(time: number): void {
    this.processingTimes.push(time)

    if (this.processingTimes.length > 100) {
      this.processingTimes.shift()
    }

    const sum = this.processingTimes.reduce((a, b) => a + b, 0)
    this.stats.avgProcessingTime = sum / this.processingTimes.length
  }

  async processRetryableEvents(): Promise<void> {
    const failedEvents = await eventEmitter.getEvents({
      status: EventStatus.FAILED,
      limit: 50,
    })

    const retryableEvents = failedEvents.filter(
      (event) => event.retryCount < event.maxRetries
    )

    for (const event of retryableEvents) {
      await eventConsumer.retryFailedEvent(event.id)
    }

    logger.info(`Queued ${retryableEvents.length} events for retry`)
  }

  async cleanupOldEvents(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const deletedCount = await eventEmitter.deleteEvents({
      status: EventStatus.COMPLETED,
      createdBefore: cutoffDate,
    })

    logger.info(`Cleaned up ${deletedCount} old completed events`)
    return deletedCount
  }

  async cleanupFailedEvents(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const deletedCount = await eventEmitter.deleteEvents({
      status: EventStatus.FAILED,
      createdBefore: cutoffDate,
    })

    logger.info(`Cleaned up ${deletedCount} old failed events`)
    return deletedCount
  }

  async resetStats(): Promise<void> {
    this.stats.eventsProcessed = 0
    this.stats.eventsSucceeded = 0
    this.stats.eventsFailed = 0
    this.stats.eventsRetried = 0
    this.stats.lastProcessedAt = null
    this.stats.avgProcessingTime = 0
    this.stats.currentBatch = 0
    this.processingTimes = []
  }
}

export const eventWorker = EventWorker.getInstance()
