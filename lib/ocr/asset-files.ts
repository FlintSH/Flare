import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { OCR_ASSETS, type OcrAssetName } from './assets'

/**
 * Reads the files of text recognition from the installed packages. The
 * Docker image has them through `outputFileTracingIncludes` in
 * `next.config.ts`.
 */

const modules = () =>
  join(/* turbopackIgnore: true */ process.cwd(), 'node_modules')

/** `tesseract.js-core` is a dependency of `tesseract.js`: with pnpm it is beside it, not at the top. */
async function packageDirectory(name: string) {
  if (name !== 'tesseract.js-core') return join(modules(), name)
  const tesseract = await realpath(join(modules(), 'tesseract.js'))
  return join(tesseract, '..', 'tesseract.js-core')
}

const cache = new Map<OcrAssetName, Promise<Buffer>>()

export function readOcrAsset(name: OcrAssetName): Promise<Buffer> {
  let known = cache.get(name)
  if (!known) {
    const asset = OCR_ASSETS[name]
    known = packageDirectory(asset.package).then((directory) =>
      readFile(join(directory, asset.path))
    )
    // A failed read is tried again at the next request.
    known.catch(() => cache.delete(name))
    cache.set(name, known)
  }
  return known
}
