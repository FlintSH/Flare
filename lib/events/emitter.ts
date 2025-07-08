import type {
  BaseEvent,
  EventEmissionOptions,
  EventFilter,
  EventPayload,
  EventStats,
  EventType,
} from '@/types/events'
import { EventStatus } from '@/types/events'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'

export class EventEmitter {
  private static instance: EventEmitter | null = null

  private constructor() {}

  static getInstance(): EventEmitter {
    if (!EventEmitter.instance) {
      EventEmitter.instance = new EventEmitter()
    }
    return EventEmitter.instance
  }

  async emit<T extends EventType>(
    type: T,
    payload: EventPayload<T>,
    options: EventEmissionOptions = {}
  ): Promise<BaseEvent> {
    const { priority = 0, scheduledAt, maxRetries = 3, metadata } = options

    const status =
      scheduledAt && scheduledAt > new Date()
        ? EventStatus.SCHEDULED
        : EventStatus.PENDING

    const event = await prisma.event.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        status,
        priority,
        scheduledAt,
        maxRetries,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    })

    console.log(`Event emitted: ${type} (${event.id})`)

    return event as BaseEvent
  }

  async emitMany<T extends EventType>(
    events: Array<{
      type: T
      payload: EventPayload<T>
      options?: EventEmissionOptions
    }>
  ): Promise<BaseEvent[]> {
    const eventData = events.map(({ type, payload, options = {} }) => {
      const { priority = 0, scheduledAt, maxRetries = 3, metadata } = options

      const status =
        scheduledAt && scheduledAt > new Date()
          ? EventStatus.SCHEDULED
          : EventStatus.PENDING

      return {
        type,
        payload: payload as Prisma.InputJsonValue,
        status,
        priority,
        scheduledAt,
        maxRetries,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      }
    })

    const createdEvents = await prisma.event.createMany({
      data: eventData,
    })

    console.log(`${createdEvents.count} events emitted`)

    const result = await prisma.event.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 1000),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: createdEvents.count,
    })

    return result as BaseEvent[]
  }

  async getEvent(id: string): Promise<BaseEvent | null> {
    const event = await prisma.event.findUnique({
      where: { id },
    })

    return event as BaseEvent | null
  }

  async getEvents(filter: EventFilter = {}): Promise<BaseEvent[]> {
    const {
      type,
      status,
      priority,
      scheduledBefore,
      scheduledAfter,
      createdBefore,
      createdAfter,
      limit = 100,
      offset = 0,
    } = filter

    const where: Prisma.EventWhereInput = {}

    if (type) where.type = type
    if (status) where.status = status
    if (priority !== undefined) where.priority = priority
    if (scheduledBefore || scheduledAfter) {
      where.scheduledAt = {}
      if (scheduledBefore) where.scheduledAt.lte = scheduledBefore
      if (scheduledAfter) where.scheduledAt.gte = scheduledAfter
    }
    if (createdBefore || createdAfter) {
      where.createdAt = {}
      if (createdBefore) where.createdAt.lte = createdBefore
      if (createdAfter) where.createdAt.gte = createdAfter
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      skip: offset,
    })

    return events as BaseEvent[]
  }

  async getStats(): Promise<EventStats> {
    const stats = await prisma.event.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    })

    const result: EventStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      scheduled: 0,
    }

    stats.forEach(({ status, _count }) => {
      result[status.toLowerCase() as keyof EventStats] = _count.id
    })

    return result
  }

  async updateEventStatus(
    id: string,
    status: EventStatus,
    error?: string
  ): Promise<BaseEvent | null> {
    const updateData: Prisma.EventUpdateInput = {
      status,
      updatedAt: new Date(),
    }

    if (status === EventStatus.COMPLETED) {
      updateData.processedAt = new Date()
    } else if (status === EventStatus.FAILED) {
      updateData.failedAt = new Date()
      if (error) updateData.error = error
    }

    const event = await prisma.event.update({
      where: { id },
      data: updateData,
    })

    return event as BaseEvent
  }

  async incrementRetryCount(id: string): Promise<BaseEvent | null> {
    const event = await prisma.event.update({
      where: { id },
      data: {
        retryCount: {
          increment: 1,
        },
        updatedAt: new Date(),
      },
    })

    return event as BaseEvent
  }

  async deleteEvent(id: string): Promise<boolean> {
    try {
      await prisma.event.delete({
        where: { id },
      })
      return true
    } catch (error) {
      console.error('Failed to delete event:', error)
      return false
    }
  }

  async deleteEvents(filter: EventFilter = {}): Promise<number> {
    const {
      type,
      status,
      priority,
      scheduledBefore,
      scheduledAfter,
      createdBefore,
      createdAfter,
    } = filter

    const where: Prisma.EventWhereInput = {}

    if (type) where.type = type
    if (status) where.status = status
    if (priority !== undefined) where.priority = priority
    if (scheduledBefore || scheduledAfter) {
      where.scheduledAt = {}
      if (scheduledBefore) where.scheduledAt.lte = scheduledBefore
      if (scheduledAfter) where.scheduledAt.gte = scheduledAfter
    }
    if (createdBefore || createdAfter) {
      where.createdAt = {}
      if (createdBefore) where.createdAt.lte = createdBefore
      if (createdAfter) where.createdAt.gte = createdAfter
    }

    const result = await prisma.event.deleteMany({
      where,
    })

    return result.count
  }

  async scheduleEvent<T extends EventType>(
    type: T,
    payload: EventPayload<T>,
    scheduledAt: Date,
    options: Omit<EventEmissionOptions, 'scheduledAt'> = {}
  ): Promise<BaseEvent> {
    return this.emit(type, payload, {
      ...options,
      scheduledAt,
    })
  }

  async rescheduleEvent(
    id: string,
    scheduledAt: Date
  ): Promise<BaseEvent | null> {
    const event = await prisma.event.update({
      where: { id },
      data: {
        scheduledAt,
        status: EventStatus.SCHEDULED,
        updatedAt: new Date(),
      },
    })

    return event as BaseEvent
  }

  async getScheduledEvents(before?: Date): Promise<BaseEvent[]> {
    const where: Record<string, unknown> = {
      status: EventStatus.SCHEDULED,
      scheduledAt: {
        lte: before || new Date(),
      },
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }],
    })

    return events as BaseEvent[]
  }

  async activateScheduledEvents(): Promise<number> {
    const result = await prisma.event.updateMany({
      where: {
        status: EventStatus.SCHEDULED,
        scheduledAt: {
          lte: new Date(),
        },
      },
      data: {
        status: EventStatus.PENDING,
        updatedAt: new Date(),
      },
    })

    return result.count
  }
}

export const eventEmitter = EventEmitter.getInstance()
