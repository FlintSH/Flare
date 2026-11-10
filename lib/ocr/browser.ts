import { OCR_LANGUAGE, ocrAssetBase } from './assets'

/**
 * Text recognition in the browser (docs/e2ee-spec.md, section 9.6.2), for
 * an image that only this browser can read. tesseract.js runs in a worker of
 * its own. The worker, its WebAssembly core and the language data come from
 * Flare's origin, and the worker's policy lets it reach nothing else. The
 * image and its text stay in this browser. Client only.
 */

/** An image larger than this is not read: the core holds it in memory more than one time. */
export const OCR_IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** The worker and its 20 MB of memory go after this long without work. */
const IDLE_MS = 60_000

export interface RecognizedText {
  text: string
  /** 0 to 100, as tesseract reports it. */
  confidence: number | null
}

type TesseractWorker = Awaited<
  ReturnType<(typeof import('tesseract.js'))['createWorker']>
>

let worker: Promise<TesseractWorker> | null = null
let idle: ReturnType<typeof setTimeout> | null = null
// One recognition at a time: the worker has one core.
let queue: Promise<unknown> = Promise.resolve()

function startWorker(): Promise<TesseractWorker> {
  const base = ocrAssetBase(window.location.origin)
  return import('tesseract.js').then(({ createWorker }) =>
    // 1 is "LSTM only", the engine the language data is for.
    createWorker(OCR_LANGUAGE, 1, {
      workerPath: `${base}/worker.min.js`,
      corePath: base,
      langPath: base,
      // The worker starts from its own address, so it gets its own policy.
      workerBlobURL: false,
      gzip: true,
      // The browser's HTTP cache keeps the language data. Nothing is
      // written to IndexedDB.
      cacheMethod: 'none',
    })
  )
}

const running = () => worker !== null

function stopWorker() {
  const stopping = worker
  worker = null
  if (idle) clearTimeout(idle)
  idle = null
  void stopping?.then((instance) => instance.terminate()).catch(() => undefined)
}

/**
 * Reads the text of one image. Calls wait for each other. A failure stops
 * the worker, and the next call starts a new one.
 */
export function recognizeImage(
  image: Blob,
  { signal }: { signal?: AbortSignal } = {}
): Promise<RecognizedText> {
  const run = async (): Promise<RecognizedText> => {
    signal?.throwIfAborted()
    if (image.size > OCR_IMAGE_MAX_BYTES)
      throw new Error('This image is too large to read in the browser.')
    if (idle) clearTimeout(idle)
    idle = null
    worker ??= startWorker()
    try {
      const instance = await worker
      signal?.throwIfAborted()
      const { data } = await instance.recognize(image)
      return {
        text: data.text.trim(),
        confidence:
          typeof data.confidence === 'number' ? data.confidence : null,
      }
    } catch (error) {
      stopWorker()
      throw error
    } finally {
      // A failure stopped the worker: then there is nothing to time out.
      if (running()) idle = setTimeout(stopWorker, IDLE_MS)
    }
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Stops the recognition worker now, for a page that locks or signs out. */
export function stopRecognition() {
  stopWorker()
}
