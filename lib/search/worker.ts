import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import {
  type ExtractableFile,
  type Extraction,
  ExtractionFailure,
  extractSearchableText,
  extractorFor,
} from './extract'
import {
  EXTRACTION_TIMEOUT_MS,
  SEARCH_INDEX_ATTEMPTS,
  SEARCH_INDEX_CONCURRENCY,
  SEARCH_INDEX_LEASE_MS,
} from './limits'
import {
  DOCUMENTS_OFF_REASON,
  type SearchIndexJob,
  claimSearchIndexJobs,
  renewSearchIndexLease,
  requeueOutdated,
  saveExtraction,
  saveFailure,
} from './store'

const logger = createLogger('search-index')

const UNREADABLE = 'Flare couldn’t read this file.'
const REQUEUE_EVERY_MS = 60_000

// One per process, shared by every route bundle that loads this module.
const stateKey = Symbol.for('flare.search.index-worker')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const state = (processState[stateKey] ??= {
  running: null as Promise<void> | null,
  again: false,
  requeuedAt: 0,
  versionsChecked: false,
  active: 0,
  started: false,
}) as {
  running: Promise<void> | null
  again: boolean
  requeuedAt: number
  /** Rows from an older extractor were requeued once in this process. */
  versionsChecked: boolean
  /** Extractions running in this process, including ones past their deadline. */
  active: number
  /** Whether this process runs the worker; only then do uploads nudge it. */
  started: boolean
}
// State from before a development reload may predate newer fields.
state.active ??= 0

/**
 * Extract with a deadline. Work that outlives it is aborted where it can be,
 * and keeps counting against this process's concurrency until it really
 * ends, so slow files can't pile up when their claims are retried.
 */
function extractWithin(file: ExtractableFile): Promise<Extraction> {
  const controller = new AbortController()
  state.active++
  const work = extractSearchableText(file, controller.signal).finally(
    () => state.active--
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(
          new ExtractionFailure(
            'Reading this file took too long, so Flare stopped.'
          )
        )
      }, EXTRACTION_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function readFile(job: SearchIndexJob, documents: boolean) {
  const file = await prisma.file.findUnique({
    where: { id: job.fileId },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      path: true,
      isPaste: true,
      storageTarget: true,
      ocrText: true,
    },
  })
  // Deleting the file deleted its row too.
  if (!file) return
  // A file that stopped the process every time it was read.
  if (job.attempts > SEARCH_INDEX_ATTEMPTS)
    return saveFailure(
      job,
      'Flare stopped trying after reading this file failed several times.',
      false
    )
  const extractor = extractorFor(file)
  let extraction: Extraction
  if (!documents && extractor && extractor !== 'ocr')
    extraction = {
      status: 'SKIPPED',
      source:
        extractor === 'pdf'
          ? 'pdf'
          : extractor === 'archive'
            ? 'archive'
            : extractor === 'text' || extractor === 'markup'
              ? 'text'
              : 'document',
      reason: DOCUMENTS_OFF_REASON,
    }
  else {
    const renew = setInterval(
      () => void renewSearchIndexLease(job).catch(() => undefined),
      SEARCH_INDEX_LEASE_MS / 3
    )
    renew.unref()
    try {
      extraction = await extractWithin(file)
    } catch (error) {
      const failure =
        error instanceof ExtractionFailure
          ? error
          : new ExtractionFailure(UNREADABLE)
      if (!(error instanceof ExtractionFailure))
        logger.warn('Search indexing failed unexpectedly', { fileId: file.id })
      return saveFailure(job, failure.message, failure.retry)
    } finally {
      clearInterval(renew)
    }
  }
  await saveExtraction(job, extraction)
}

/** Read one batch of waiting files. Returns how many were claimed. */
export async function runSearchIndexBatch(): Promise<number> {
  const config = (await getConfig()).settings.general
  const documents = config.search.documents
  if (Date.now() - state.requeuedAt >= REQUEUE_EVERY_MS) {
    state.requeuedAt = Date.now()
    await requeueOutdated(
      { ocr: config.ocr.enabled, documents },
      !state.versionsChecked
    )
    state.versionsChecked = true
  }
  const jobs = await claimSearchIndexJobs(
    Math.max(0, SEARCH_INDEX_CONCURRENCY - state.active)
  )
  const results = await Promise.allSettled(
    jobs.map((job) => readFile(job, documents))
  )
  if (results.some((result) => result.status === 'rejected'))
    logger.warn(
      'Some search index results could not be saved; they will be read again.'
    )
  return jobs.length
}

/** Work through the backlog until it's empty. Never runs twice at once. */
function drain(): Promise<void> {
  if (state.running) {
    state.again = true
    return state.running
  }
  state.running = (async () => {
    try {
      do {
        state.again = false
        while ((await runSearchIndexBatch()) === SEARCH_INDEX_CONCURRENCY);
      } while (state.again)
    } finally {
      state.running = null
    }
  })()
  return state.running
}

/**
 * Start reading soon after an upload commits, without waiting for the next
 * poll. The upload's response never waits for it.
 */
export function nudgeSearchIndex() {
  // Scripts and tests that publish files don't run background work.
  if (!state.started) return
  setTimeout(() => {
    drain().catch(() =>
      logger.warn('Search indexing is unavailable; retrying on the next poll.')
    )
  }, 250).unref()
}

/** Rows in the database are the queue, so work survives restarts and replicas. */
export function startSearchIndexWorker() {
  state.started = true
  return startIntervalWorker({
    key: 'search-index',
    everyMs: 10_000,
    firstRunAfterMs: 5_000,
    logger,
    failure: 'Search indexing is unavailable; retrying on the next poll.',
    run: drain,
  })
}
