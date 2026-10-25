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

/** New on-demand recognitions that may be queued at once, per process. */
export const OCR_QUEUED_REQUEST_LIMIT = 10
/**
 * Requests that may wait for a result at once, per process, including ones
 * that join an image already being read. Each holds a connection for up to
 * the wait limit, so this bounds what OCR can tie up even for one popular image.
 */
export const OCR_WAITING_REQUEST_LIMIT = 30
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

/** A spent budget point, or how long to wait when the budget is used up. */
export type OCRAdmission =
  { retryAfterSeconds: number } | { refund: () => Promise<void> | void }

interface OCRRequestOptions {
  /**
   * Charges the requester. Called only when this request is about to start
   * new recognition, never when it joins queued work, and refunded if it
   * ends up joining work that appeared meanwhile.
   */
  admit?: () => Promise<OCRAdmission>
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
  // A file whose first request is being charged. Others for it wait and join.
  private admissions = new Map<string, Promise<void>>()
  private queuedRequests = 0
  private reservedRequests = 0
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
    // Every waiting request holds a place, including ones joining work.
    if (this.waitingRequests >= OCR_WAITING_REQUEST_LIMIT)
      return { status: 'busy' }
    this.waitingRequests++
    try {
      const found = await this.workFor(task, admit)
      if (!('work' in found)) return found

      let timer: ReturnType<typeof setTimeout> | undefined
      const waited = new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), waitMs)
      })
      try {
        const outcome = await Promise.race([found.work, waited])
        return outcome === 'pending'
          ? { status: 'pending' }
          : { status: 'done', result: outcome }
      } finally {
        clearTimeout(timer)
      }
    } finally {
      this.waitingRequests--
    }
  }

  /**
   * The work this request waits for: existing work for the file, or new work
   * it was charged for. The queue place is reserved before charging, and one
   * request per file is charged at a time, so nobody pays for work they
   * didn't start or for a request the queue then refuses. The work is
   * wrapped because an async function would otherwise wait for it.
   */
  private async workFor(
    task: OCRTask,
    admit: OCRRequestOptions['admit']
  ): Promise<{ work: Promise<OCRResult> } | OCRRequestOutcome> {
    for (;;) {
      const existing = this.inFlight.get(task.fileId)
      if (existing) return { work: existing }
      const admission = this.admissions.get(task.fileId)
      if (admission) {
        await admission
        continue
      }
      const failedAt = this.failures.get(task.fileId)
      if (failedAt !== undefined) {
        const retryAfterMs = failedAt + OCR_FAILURE_COOLDOWN_MS - Date.now()
        if (retryAfterMs > 0) return { status: 'failed-recently', retryAfterMs }
        this.failures.delete(task.fileId)
      }
      // A reservation can also go straight to a free recognition slot.
      const startable = Math.max(
        0,
        this.concurrentLimit - this.activeProcesses - this.queue.length
      )
      if (
        this.queuedRequests + this.reservedRequests >=
        OCR_QUEUED_REQUEST_LIMIT + startable
      )
        return { status: 'busy' }

      this.reservedRequests++
      let release!: () => void
      this.admissions.set(
        task.fileId,
        new Promise<void>((resolve) => (release = resolve))
      )
      try {
        const charge = admit ? await admit() : null
        if (charge && 'retryAfterSeconds' in charge)
          return {
            status: 'limited',
            retryAfterSeconds: charge.retryAfterSeconds,
          }
        // Upload processing can queue the same file while this is charged.
        const queued = this.inFlight.get(task.fileId)
        if (queued) {
          await charge?.refund()
          return { work: queued }
        }
        return { work: this.enqueue(task, true) }
      } finally {
        this.reservedRequests--
        this.admissions.delete(task.fileId)
        release()
      }
    }
  }

  private enqueue(task: OCRTask, onDemand: boolean): Promise<OCRResult> {
    const existing = this.inFlight.get(task.fileId)
    if (existing) return existing

    let settle!: (result: OCRResult) => void
    const done = new Promise<OCRResult>((resolve) => (settle = resolve))
    this.inFlight.set(task.fileId, done)
    if (onDemand) this.queuedRequests++

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
      if (task.onDemand) this.queuedRequests--

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
