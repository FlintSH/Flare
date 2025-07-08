import type {
  BaseEvent,
  EventEmissionOptions,
  EventFilter,
  EventHandlerFunction,
  EventHandlerOptions,
  EventHandlerRegistration,
  EventPayload,
  EventProcessingResult,
  EventStats,
  EventType,
  EventWorkerOptions,
} from '@/types/events'

import { eventConsumer } from './consumer'
import { eventEmitter } from './emitter'
import { eventWorker } from './worker'

export class EventSystem {
  private static instance: EventSystem | null = null

  private constructor() {}

  static getInstance(): EventSystem {
    if (!EventSystem.instance) {
      EventSystem.instance = new EventSystem()
    }
    return EventSystem.instance
  }

  async emit<T extends EventType>(
    type: T,
    payload: EventPayload<T>,
    options?: EventEmissionOptions
  ): Promise<BaseEvent> {
    return eventEmitter.emit(type, payload, options)
  }

  async emitMany<T extends EventType>(
    events: Array<{
      type: T
      payload: EventPayload<T>
      options?: EventEmissionOptions
    }>
  ): Promise<BaseEvent[]> {
    return eventEmitter.emitMany(events)
  }

  async schedule<T extends EventType>(
    type: T,
    payload: EventPayload<T>,
    scheduledAt: Date,
    options?: Omit<EventEmissionOptions, 'scheduledAt'>
  ): Promise<BaseEvent> {
    return eventEmitter.scheduleEvent(type, payload, scheduledAt, options)
  }

  async on<T extends EventType>(
    eventType: T,
    handlerName: string,
    handler: EventHandlerFunction<EventPayload<T>>,
    options?: EventHandlerOptions
  ): Promise<EventHandlerRegistration> {
    return eventConsumer.registerHandler(
      eventType,
      handlerName,
      handler,
      options
    )
  }

  async off(eventType: string, handlerName: string): Promise<boolean> {
    return eventConsumer.unregisterHandler(eventType, handlerName)
  }

  async enableHandler(
    eventType: string,
    handlerName: string
  ): Promise<boolean> {
    return eventConsumer.enableHandler(eventType, handlerName)
  }

  async disableHandler(
    eventType: string,
    handlerName: string
  ): Promise<boolean> {
    return eventConsumer.disableHandler(eventType, handlerName)
  }

  async getEvent(id: string): Promise<BaseEvent | null> {
    return eventEmitter.getEvent(id)
  }

  async getEvents(filter?: EventFilter): Promise<BaseEvent[]> {
    return eventEmitter.getEvents(filter)
  }

  async getStats(): Promise<EventStats> {
    return eventEmitter.getStats()
  }

  async getHandlers(): Promise<EventHandlerRegistration[]> {
    return eventConsumer.getHandlers()
  }

  async getHandlersByEventType(
    eventType: string
  ): Promise<EventHandlerRegistration[]> {
    return eventConsumer.getHandlersByEventType(eventType)
  }

  async processEvent(event: BaseEvent): Promise<EventProcessingResult> {
    return eventConsumer.processEvent(event)
  }

  async retryFailedEvent(eventId: string): Promise<boolean> {
    return eventConsumer.retryFailedEvent(eventId)
  }

  async deleteEvent(id: string): Promise<boolean> {
    return eventEmitter.deleteEvent(id)
  }

  async deleteEvents(filter?: EventFilter): Promise<number> {
    return eventEmitter.deleteEvents(filter)
  }

  async rescheduleEvent(
    id: string,
    scheduledAt: Date
  ): Promise<BaseEvent | null> {
    return eventEmitter.rescheduleEvent(id, scheduledAt)
  }

  async startWorker(options?: EventWorkerOptions): Promise<void> {
    return eventWorker.start(options)
  }

  async stopWorker(): Promise<void> {
    return eventWorker.stop()
  }

  isWorkerRunning(): boolean {
    return eventWorker.isRunning()
  }

  getWorkerStats() {
    return eventWorker.getStats()
  }

  isProcessing(eventId: string): boolean {
    return eventConsumer.isProcessing(eventId)
  }

  getProcessingEvents(): string[] {
    return eventConsumer.getProcessingEvents()
  }
}

export const events = EventSystem.getInstance()

export * from './emitter'
export * from './consumer'
export * from './worker'
export * from '@/types/events'

export default events
