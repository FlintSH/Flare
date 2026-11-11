/**
 * The files that text recognition in the browser loads (docs/e2ee-spec.md,
 * section 9.6.2): the tesseract.js worker, its WebAssembly core and the
 * English language data. Flare serves them from its own origin under
 * `/api/ocr/{version}/`. The browser never asks another site for them.
 *
 * The version is part of the address, so the files can be cached for a long
 * time and a new release of Flare never mixes an old worker with a new
 * core. A test fails when it does not name the installed packages.
 *
 * No Node.js imports: the browser bundles this module too.
 */
export const OCR_ASSET_VERSION = 'tesseract-6.0.1-core-6.1.2-eng-4.0.0'

/** The language that Flare reads, as the server always did. */
export const OCR_LANGUAGE = 'eng'

/** Every file the route serves. No other name is answered. */
export const OCR_ASSETS = {
  'worker.min.js': {
    package: 'tesseract.js',
    path: 'dist/worker.min.js',
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core.wasm.js': {
    package: 'tesseract.js-core',
    path: 'tesseract-core.wasm.js',
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core-simd.wasm.js': {
    package: 'tesseract.js-core',
    path: 'tesseract-core-simd.wasm.js',
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core-lstm.wasm.js': {
    package: 'tesseract.js-core',
    path: 'tesseract-core-lstm.wasm.js',
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core-simd-lstm.wasm.js': {
    package: 'tesseract.js-core',
    path: 'tesseract-core-simd-lstm.wasm.js',
    type: 'text/javascript; charset=utf-8',
  },
  'eng.traineddata.gz': {
    package: '@tesseract.js-data/eng',
    path: '4.0.0_best_int/eng.traineddata.gz',
    // The worker unpacks it. No `Content-Encoding`: the bytes go as they are.
    type: 'application/octet-stream',
  },
} as const

export type OcrAssetName = keyof typeof OCR_ASSETS

export function isOcrAsset(name: string): name is OcrAssetName {
  return Object.hasOwn(OCR_ASSETS, name)
}

/** Where the browser loads the files from. */
export function ocrAssetBase(origin: string) {
  return `${origin}/api/ocr/${OCR_ASSET_VERSION}`
}

/**
 * The policy of the recognition worker. A worker has the policy of its own
 * script, not of the page that started it. This one lets it load script and
 * data from Flare's origin only, and compile the WebAssembly core. It can
 * reach no other site, also when it reads an image that a stranger made.
 */
export const OCR_WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
