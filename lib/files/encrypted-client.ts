import {
  type DecryptedContent,
  decryptInWorker,
} from '@/lib/e2ee/client/file-worker'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import { fileLayout } from '@/lib/e2ee/file'

import { DOWNLOAD_BLOB_TYPE, safeFileName } from './safe-render'
import { fileUrls } from './urls'

/**
 * What the browser does with the content of an encrypted file: fetch the
 * ciphertext, decrypt it in a worker, and show or save the result
 * (docs/e2ee-spec.md, section 7.4). Client only.
 */

/** Where the ciphertext of a file is served, with byte ranges. */
export function ciphertextUrl(
  file: { id: string; urlPath: string },
  { download = false }: { download?: boolean } = {}
) {
  const url = new URL(fileUrls(file).content, window.location.origin)
  if (download) url.searchParams.set('download', 'true')
  return url.href
}

/** The size of the plaintext that a ciphertext size implies, or null if no file has that size. */
export function plaintextSize(storedBytes: number): number | null {
  try {
    return fileLayout(storedBytes).plaintextLength
  } catch {
    return null
  }
}

export function fetchDecrypted(
  file: { id: string; urlPath: string },
  opened: Pick<OpenedFile, 'fileKey'>,
  options: {
    download?: boolean
    signal?: AbortSignal
    maxBytes?: number
    onProgress?: (loaded: number, total: number | null) => void
  } = {}
): Promise<DecryptedContent> {
  return decryptInWorker({
    url: ciphertextUrl(file, { download: options.download }),
    fileKey: opened.fileKey,
    signal: options.signal,
    maxBytes: options.maxBytes,
    onProgress: options.onProgress,
  })
}

/**
 * Saves decrypted content as a file. The Blob has the generic type and the
 * link has the `download` attribute, so the browser saves the bytes and
 * never opens them as a page, whatever they are. `content` must be the
 * complete, verified output of `fetchDecrypted`.
 */
export function saveDecrypted(content: DecryptedContent, name: unknown) {
  const url = URL.createObjectURL(
    new Blob(content.parts, { type: DOWNLOAD_BLOB_TYPE })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = safeFileName(name)
  link.rel = 'noopener'
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  // The browser has started the save; the address is not needed after that.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Why content did not open, in words for a person. */
export function decryptionProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'CiphertextRefused')
    return 'The server did not send this file. It may have been deleted or made private.'
  if (name === 'E2eeError')
    return 'This file did not pass its integrity check. It was changed or cut after it was encrypted, so Flare will not show or save it.'
  return 'The file could not be loaded. Check your connection and try again.'
}
