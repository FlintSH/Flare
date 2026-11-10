import type {
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
} from './archive.worker'
import type {
  CreateResult,
  ExtractResult,
  JobProgress,
  MakeExtractionFolders,
} from './jobs'

/**
 * The page's side of `archive.worker.ts`. Each call starts one worker and
 * terminates it when the job ends or the caller aborts.
 */
export class ArchiveJobError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ArchiveJobError'
  }
}

function run<Result>(
  request: ArchiveWorkerRequest,
  done: (message: ArchiveWorkerResponse) => Result | undefined,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: JobProgress) => void
    folders?: MakeExtractionFolders
  }
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), {
      type: 'module',
    })
    let settled = false
    const end = (result: { value: Result } | { error: Error }) => {
      if (settled) return
      settled = true
      worker.terminate()
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') options.onProgress?.(message.progress)
      else if (message.type === 'folders') {
        const make =
          options.folders ??
          (() => Promise.reject(new Error('This job makes no folders.')))
        make(message.planned).then(
          (made) => {
            if (!settled)
              worker.postMessage({ type: 'folders', made: [...made] })
          },
          (error: unknown) =>
            end({
              error:
                error instanceof Error
                  ? error
                  : new ArchiveJobError('The folders could not be made.'),
            })
        )
      } else if (message.type === 'error')
        end({ error: new ArchiveJobError(message.message, message.status) })
      else {
        const value = done(message)
        if (value !== undefined) end({ value })
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      end({ error: new ArchiveJobError('The archive tool stopped working.') })
    }
    options.signal?.addEventListener(
      'abort',
      () => end({ error: new DOMException('Aborted', 'AbortError') }),
      { once: true }
    )
    worker.postMessage(request)
  })
}

type JobOptions = {
  signal?: AbortSignal
  onProgress?: (progress: JobProgress) => void
}

/**
 * `folders` makes the account folders once the worker checked the archive
 * (see `MakeExtractionFolders`). If it rejects, the job ends with its error.
 */
export function extractInWorker(
  request: Omit<Extract<ArchiveWorkerRequest, { type: 'extract' }>, 'type'>,
  options: JobOptions & { folders: MakeExtractionFolders }
): Promise<ExtractResult> {
  return run(
    { type: 'extract', ...request },
    (message) => (message.type === 'extracted' ? message.result : undefined),
    options
  )
}

export function createInWorker(
  request: Omit<Extract<ArchiveWorkerRequest, { type: 'create' }>, 'type'>,
  options: JobOptions = {}
): Promise<CreateResult> {
  return run(
    { type: 'create', ...request },
    (message) => (message.type === 'created' ? message.result : undefined),
    options
  )
}
