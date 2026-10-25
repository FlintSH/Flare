import { type AuditContext, auditContext } from '@/lib/audit/context'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'

import { type OCRResult, processImageOCRTask } from './processor'

const logger = loggers.ocr

interface OCRTask {
  filePath: string
  fileId: string
  audit?: Omit<AuditContext, 'pending'>
}

/** On-demand requests that may wait for the recognition slot at once, per process. */
export const OCR_WAITING_REQUEST_LIMIT = 10
/**
 * How long an on-demand request waits before answering that recognition is
 * still running. Below common proxy timeouts, such as Cloudflare's 100 seconds.
 */
export const OCR_REQUEST_WAIT_MS = 60_000
/** A failed recognition is not repeated on request until this has passed. */
export const OCR_FAILURE_COOLDOWN_MS = 5 * 60_000
const REMEMBERED_FAILURES = 1_000

export type OCRRequestOutcome =
  | { status: 'done'; result: OCRResult }
  /** Still queued or running when the wait ended; it continues in the background. */
  | { status: 'pending' }
  /** Too many on-demand requests are already waiting. */
  | { status: 'busy' }
  /** The requester's budget for starting recognition is spent. */
  | { status: 'limited'; retryAfterSeconds: number }
  | { status: 'failed-recently'; retryAfterMs: number }

interface OCRRequestOptions {
  /**
   * Called only when this request would start new recognition, never when it
   * joins queued work. Returns seconds to wait, or null to proceed.
   */
  admit?: () => Promise<number | null>
  waitMs?: number
}

type QueuedTask = OCRTask & {
  onDemand: boolean
  settle: (result: OCRResult) => void
}

class OCRQueue {
  private queue: QueuedTask[] = []
  private processing: boolean = false
  private concurrentLimit: number = 1
  private activeProcesses: number = 0
  // Queued or running work by file, so every caller shares one recognition.
  private inFlight = new Map<string, Promise<OCRResult>>()
  private waitingRequests = 0
  private failures = new Map<string, number>()

  /** Background processing after upload. Resolves once the task is queued. */
  async add(task: OCRTask, force: boolean = false) {
    if (!force) {
      const config = await getConfig()
      if (!config.settings.general.ocr.enabled) {
        logger.debug('OCR processing is disabled in settings, skipping queue', {
          fileId: task.fileId,
        })
        await prisma.file.update({
          where: { id: task.fileId },
          data: {
            isOcrProcessed: true,
            ocrText: null,
            ocrConfidence: null,
          },
        })
        return
      }
    }

    void this.enqueue(task, false)
  }

  /** True while recognition for this file is queued or running. */
  isQueued(fileId: string): boolean {
    return this.inFlight.has(fileId)
  }

  /**
   * Recognition someone asked for. Joins work already queued for the file and
   * shares the queue's single recognition slot with upload processing.
   * Automatic OCR may be disabled; manual extraction stays available.
   */
  async request(
    task: OCRTask,
    { admit, waitMs = OCR_REQUEST_WAIT_MS }: OCRRequestOptions = {}
  ): Promise<OCRRequestOutcome> {
    let done = this.inFlight.get(task.fileId)
    if (!done) {
      const failedAt = this.failures.get(task.fileId)
      if (failedAt !== undefined) {
        const retryAfterMs = failedAt + OCR_FAILURE_COOLDOWN_MS - Date.now()
        if (retryAfterMs > 0) return { status: 'failed-recently', retryAfterMs }
        this.failures.delete(task.fileId)
      }
      if (this.waitingRequests >= OCR_WAITING_REQUEST_LIMIT)
        return { status: 'busy' }
      const retryAfterSeconds = await admit?.()
      if (retryAfterSeconds) return { status: 'limited', retryAfterSeconds }
      // Another request may have queued this file or filled the queue meanwhile.
      done = this.inFlight.get(task.fileId)
      if (!done) {
        if (this.waitingRequests >= OCR_WAITING_REQUEST_LIMIT)
          return { status: 'busy' }
        done = this.enqueue(task, true)
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), waitMs)
    })
    try {
      const outcome = await Promise.race([done, waited])
      return outcome === 'pending'
        ? { status: 'pending' }
        : { status: 'done', result: outcome }
    } finally {
      clearTimeout(timer)
    }
  }

  private enqueue(task: OCRTask, onDemand: boolean): Promise<OCRResult> {
    const existing = this.inFlight.get(task.fileId)
    if (existing) return existing

    let settle!: (result: OCRResult) => void
    const done = new Promise<OCRResult>((resolve) => (settle = resolve))
    this.inFlight.set(task.fileId, done)
    if (onDemand) this.waitingRequests++

    const context = auditContext.getStore()
    this.queue.push({
      ...task,
      audit: context
        ? {
            requestId: context.requestId,
            actorId: context.actorId,
            actorName: context.actorName,
            tokenId: context.tokenId,
          }
        : { actorName: 'System' },
      onDemand,
      settle,
    })
    void this.processQueue()
    return done
  }

  private rememberFailure(fileId: string) {
    this.failures.delete(fileId)
    if (this.failures.size >= REMEMBERED_FAILURES) {
      const oldest = this.failures.keys().next().value
      if (oldest !== undefined) this.failures.delete(oldest)
    }
    this.failures.set(fileId, Date.now())
  }

  private async processQueue() {
    if (this.processing || this.activeProcesses >= this.concurrentLimit) return

    this.processing = true

    while (
      this.queue.length > 0 &&
      this.activeProcesses < this.concurrentLimit
    ) {
      const task = this.queue.shift()
      if (!task) continue
      if (task.onDemand) this.waitingRequests--

      this.activeProcesses++

      let result: OCRResult
      try {
        result = await auditContext.run(
          task.audit ?? { actorName: 'System' },
          () => processImageOCRTask(task)
        )
      } catch (error) {
        logger.error(
          `OCR processing failed for file ${task.filePath}`,
          error as Error,
          {
            fileId: task.fileId,
          }
        )
        result = { success: false, error: 'OCR processing failed' }
      } finally {
        this.activeProcesses--
      }

      if (result.success) this.failures.delete(task.fileId)
      else this.rememberFailure(task.fileId)
      this.inFlight.delete(task.fileId)
      task.settle(result)
    }

    this.processing = false

    if (this.queue.length > 0 && this.activeProcesses < this.concurrentLimit) {
      this.processQueue()
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getActiveProcesses(): number {
    return this.activeProcesses
  }
}

export const ocrQueue = new OCRQueue()

export type { OCRTask }
