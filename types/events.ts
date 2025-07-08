export enum EventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SCHEDULED = 'SCHEDULED',
}

export interface BaseEvent {
  id: string
  type: string
  payload: Record<string, any>
  status: EventStatus
  priority: number
  scheduledAt?: Date
  createdAt: Date
  updatedAt: Date
  processedAt?: Date
  failedAt?: Date
  retryCount: number
  maxRetries: number
  error?: string
  metadata?: Record<string, any>
}

export interface EventEmissionOptions {
  priority?: number
  scheduledAt?: Date
  maxRetries?: number
  metadata?: Record<string, any>
}

export interface EventHandlerFunction<T = any> {
  (payload: T, event: BaseEvent): Promise<void> | void
}

export interface EventHandlerOptions {
  enabled?: boolean
  maxConcurrency?: number
  retryDelay?: number
  timeout?: number
}

export interface EventHandlerRegistration {
  id: string
  eventType: string
  handler: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface EventProcessingResult {
  success: boolean
  error?: string
  shouldRetry?: boolean
  retryAfter?: number
}

export interface EventWorkerOptions {
  batchSize?: number
  pollInterval?: number
  maxConcurrency?: number
  enableScheduledEvents?: boolean
}

export interface EventStats {
  pending: number
  processing: number
  completed: number
  failed: number
  scheduled: number
}

export interface EventFilter {
  type?: string
  status?: EventStatus
  priority?: number
  scheduledBefore?: Date
  scheduledAfter?: Date
  createdBefore?: Date
  createdAfter?: Date
  limit?: number
  offset?: number
}

export type EventTypeMap = {
  'file.schedule-expiration': {
    fileId: string
    userId: string
    fileName: string
    expiresAt: Date
  }
  'file.expired': {
    fileId: string
    userId: string
    fileName: string
    filePath: string
    size: number
  }
}

export type EventType = keyof EventTypeMap
export type EventPayload<T extends EventType> = EventTypeMap[T]
