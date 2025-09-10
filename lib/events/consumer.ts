import type {
  BaseEvent,
  EventHandlerFunction,
  EventHandlerOptions,
  EventHandlerRegistration,
  EventProcessingResult,
  EventType,
} from '@/types/events'
import { EventStatus } from '@/types/events'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'

import { eventEmitter } from './emitter'

const logger = loggers.events.getChildLogger('consumer')

export class EventConsumer {
  private static instance: EventConsumer | null = null
  private handlers: Map<string, EventHandlerFunction> = new Map()
  private handlerOptions: Map<string, EventHandlerOptions> = new Map()
  private processing: Set<string> = new Set()

  private constructor() {}

  static getInstance(): EventConsumer {
    if (!EventConsumer.instance) {
      EventConsumer.instance = new EventConsumer()
    }
    return EventConsumer.instance
  }

  async registerHandler<T extends EventType>(
    eventType: T,
    handlerName: string,
    handler: EventHandlerFunction,
    options: EventHandlerOptions = {}
  ): Promise<EventHandlerRegistration> {
    const handlerKey = `${eventType}:${handlerName}`

    this.handlers.set(handlerKey, handler)
    this.handlerOptions.set(handlerKey, {
      enabled: true,
      maxConcurrency: 1,
      retryDelay: 1000,
      timeout: 30000,
      ...options,
    })

    const registration = await prisma.eventHandler.upsert({
      where: {
        eventType_handler: {
          eventType,
          handler: handlerName,
        },
      },
      update: {
        enabled: options.enabled ?? true,
        updatedAt: new Date(),
      },
      create: {
        eventType,
        handler: handlerName,
        enabled: options.enabled ?? true,
      },
    })

    logger.info('Event handler registered', {
      eventType,
      handlerName,
      enabled: options.enabled ?? true,
    })

    return registration as EventHandlerRegistration
  }

  async unregisterHandler(
    eventType: string,
    handlerName: string
  ): Promise<boolean> {
    const handlerKey = `${eventType}:${handlerName}`

    this.handlers.delete(handlerKey)
    this.handlerOptions.delete(handlerKey)

    try {
      await prisma.eventHandler.delete({
        where: {
          eventType_handler: {
            eventType,
            handler: handlerName,
          },
        },
      })

      logger.info('Event handler unregistered', { eventType, handlerName })
      return true
    } catch (error) {
      logger.error('Failed to unregister handler', error as Error, {
        eventType,
        handlerName,
      })
      return false
    }
  }

  async enableHandler(
    eventType: string,
    handlerName: string
  ): Promise<boolean> {
    const handlerKey = `${eventType}:${handlerName}`

    const options = this.handlerOptions.get(handlerKey)
    if (options) {
      options.enabled = true
    }

    try {
      await prisma.eventHandler.update({
        where: {
          eventType_handler: {
            eventType,
            handler: handlerName,
          },
        },
        data: {
          enabled: true,
          updatedAt: new Date(),
        },
      })

      logger.info('Event handler enabled', { eventType, handlerName })
      return true
    } catch (error) {
      logger.error('Failed to enable handler', error as Error, {
        eventType,
        handlerName,
      })
      return false
    }
  }

  async disableHandler(
    eventType: string,
    handlerName: string
  ): Promise<boolean> {
    const handlerKey = `${eventType}:${handlerName}`

    const options = this.handlerOptions.get(handlerKey)
    if (options) {
      options.enabled = false
    }

    try {
      await prisma.eventHandler.update({
        where: {
          eventType_handler: {
            eventType,
            handler: handlerName,
          },
        },
        data: {
          enabled: false,
          updatedAt: new Date(),
        },
      })

      logger.info('Event handler disabled', { eventType, handlerName })
      return true
    } catch (error) {
      logger.error('Failed to disable handler', error as Error, {
        eventType,
        handlerName,
      })
      return false
    }
  }

  async processEvent(event: BaseEvent): Promise<EventProcessingResult> {
    if (this.processing.has(event.id)) {
      return { success: false, error: 'Event is already being processed' }
    }

    this.processing.add(event.id)

    try {
      await eventEmitter.updateEventStatus(event.id, EventStatus.PROCESSING)

      const eventHandlers = await prisma.eventHandler.findMany({
        where: {
          eventType: event.type,
          enabled: true,
        },
      })

      if (eventHandlers.length === 0) {
        logger.warn('No handlers found for event type', {
          eventType: event.type,
          eventId: event.id,
        })
        await eventEmitter.updateEventStatus(event.id, EventStatus.COMPLETED)
        return { success: true }
      }

      const results = await Promise.allSettled(
        eventHandlers.map((handler) => this.executeHandler(event, handler))
      )

      const failures = results.filter((result) => result.status === 'rejected')

      if (failures.length > 0) {
        const errors = failures.map(
          (f) => (f as PromiseRejectedResult).reason?.message || 'Unknown error'
        )
        const combinedError = errors.join('; ')

        await eventEmitter.updateEventStatus(
          event.id,
          EventStatus.FAILED,
          combinedError
        )

        return {
          success: false,
          error: combinedError,
          shouldRetry: event.retryCount < event.maxRetries,
        }
      }

      await eventEmitter.updateEventStatus(event.id, EventStatus.COMPLETED)
      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      await eventEmitter.updateEventStatus(
        event.id,
        EventStatus.FAILED,
        errorMessage
      )

      return {
        success: false,
        error: errorMessage,
        shouldRetry: event.retryCount < event.maxRetries,
      }
    } finally {
      this.processing.delete(event.id)
    }
  }

  private async executeHandler(
    event: BaseEvent,
    handlerRegistration: EventHandlerRegistration
  ): Promise<void> {
    const handlerKey = `${event.type}:${handlerRegistration.handler}`
    const handler = this.handlers.get(handlerKey)
    const options = this.handlerOptions.get(handlerKey)

    if (!handler) {
      throw new Error(`Handler not found: ${handlerKey}`)
    }

    if (!options?.enabled) {
      throw new Error(`Handler disabled: ${handlerKey}`)
    }

    const timeout = options.timeout || 30000

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Handler timeout: ${handlerKey}`))
      }, timeout)

      Promise.resolve(handler(event.payload, event))
        .then(() => {
          clearTimeout(timer)
          resolve()
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  async retryFailedEvent(eventId: string): Promise<boolean> {
    const event = await eventEmitter.getEvent(eventId)

    if (!event) {
      logger.error('Event not found for retry', { eventId })
      return false
    }

    if (event.status !== EventStatus.FAILED) {
      logger.error('Event is not in failed state', {
        eventId,
        currentStatus: event.status,
      })
      return false
    }

    if (event.retryCount >= event.maxRetries) {
      logger.warn('Event has exceeded max retries', {
        eventId,
        retryCount: event.retryCount,
        maxRetries: event.maxRetries,
      })
      return false
    }

    await eventEmitter.incrementRetryCount(eventId)
    await eventEmitter.updateEventStatus(eventId, EventStatus.PENDING)

    logger.info('Event queued for retry', {
      eventId,
      retryCount: event.retryCount + 1,
    })
    return true
  }

  async getHandlers(): Promise<EventHandlerRegistration[]> {
    const handlers = await prisma.eventHandler.findMany({
      orderBy: [{ eventType: 'asc' }, { handler: 'asc' }],
    })

    return handlers as EventHandlerRegistration[]
  }

  async getHandlersByEventType(
    eventType: string
  ): Promise<EventHandlerRegistration[]> {
    const handlers = await prisma.eventHandler.findMany({
      where: {
        eventType,
      },
      orderBy: {
        handler: 'asc',
      },
    })

    return handlers as EventHandlerRegistration[]
  }

  isProcessing(eventId: string): boolean {
    return this.processing.has(eventId)
  }

  getProcessingEvents(): string[] {
    return Array.from(this.processing)
  }
}

export const eventConsumer = EventConsumer.getInstance()
