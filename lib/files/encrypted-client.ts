import {
  CiphertextRefused,
  type DecryptedContent,
  decryptInWorker,
} from '@/lib/e2ee/client/file-worker'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import {
  type LocalAddress,
  type LocalAddressEvent,
  type LocalAddresses,
  localAddresses,
} from '@/lib/e2ee/client/local-address'
import { E2eeError } from '@/lib/e2ee/errors'
import { fileLayout } from '@/lib/e2ee/file'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import type { LocalMember, LocalSource } from '@/lib/e2ee/sw/protocol'

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

/** A file as a local address reads it: where its ciphertext is, and its key. */
export interface LocalFile {
  id: string
  urlPath: string
  /** The 26-byte header as the records carry it, in base64url. */
  header: string
  /** The size of the ciphertext in bytes, where the page knows it. */
  sizeBytes?: number
}

/**
 * What the service worker needs to read a file: the address of its
 * ciphertext, its key, its header and its length (docs/e2ee-spec.md,
 * section 12.2). The address has no query: the key is never part of it.
 */
export function localFileSource(
  file: LocalFile,
  opened: Pick<OpenedFile, 'fileKey'>,
  member?: LocalMember
): LocalSource {
  return {
    kind: 'file',
    url: fileUrls(file).content,
    fileKey: opened.fileKey,
    header: base64urlDecode(file.header),
    storedLength: file.sizeBytes,
    member,
  }
}

function failure(reason: string): Error {
  if (reason === 'integrity')
    return new E2eeError('tag_mismatch', 'The file did not open')
  if (reason === 'refused') return new CiphertextRefused(404)
  return new Error('The file could not be loaded')
}

const DOWNLOAD_START_MS = 15_000

/**
 * Saves the bytes of a `download` address: a hidden frame goes to the
 * address, the worker answers with an attachment, and the browser writes
 * the stream to disk. The plaintext is never whole in memory.
 *
 * Resolves `'saved'` when the worker gave the last byte, `'cancelled'` when
 * the person stopped it, and `'unavailable'` when no worker answered, so the
 * caller can use the download that holds the file in memory. Rejects when
 * the file failed its integrity check or the server refused it: the browser
 * then shows a failed download and keeps no file.
 */
export function saveLocalAddress(
  address: LocalAddress,
  { signal }: { signal?: AbortSignal } = {}
): Promise<'saved' | 'cancelled' | 'unavailable'> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    let started = false
    const finish = (result: 'saved' | 'cancelled' | 'unavailable' | Error) => {
      window.clearTimeout(timer)
      unwatch()
      signal?.removeEventListener('abort', onAbort)
      address.release()
      // The browser owns the transfer once it began; the frame can go.
      window.setTimeout(() => frame.remove(), 1000)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const onAbort = () => finish('cancelled')
    const unwatch = address.watch((event: LocalAddressEvent) => {
      if (event.type === 'started') {
        started = true
        window.clearTimeout(timer)
      } else if (event.type === 'finished') finish('saved')
      else if (event.reason === 'cancelled') finish('cancelled')
      else finish(failure(event.reason))
    })
    const timer = window.setTimeout(() => {
      if (!started) finish('unavailable')
    }, DOWNLOAD_START_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    address.registered.then(
      () => {
        if (signal?.aborted) return
        frame.src = address.url
        document.body.appendChild(frame)
      },
      () => finish('unavailable')
    )
  })
}

/** A `download` address for a whole file, under its decrypted name. */
export function downloadAddress(
  service: LocalAddresses,
  file: LocalFile,
  opened: Pick<OpenedFile, 'fileKey' | 'name'>
): LocalAddress {
  return service.create({
    mode: 'download',
    contentType: DOWNLOAD_BLOB_TYPE,
    filename: safeFileName(opened.name),
    source: localFileSource(file, opened),
    countDownload: true,
  })
}

/**
 * Downloads an encrypted file to disk. With a service worker the browser
 * saves the decrypted stream as it arrives, so the size of the file does
 * not matter. Without one the file is decrypted in memory first, as before
 * (section 12.2). Either way nothing is kept of a file that fails its
 * integrity check.
 */
export async function downloadDecrypted(
  file: LocalFile,
  opened: Pick<OpenedFile, 'fileKey' | 'name'>,
  { signal }: { signal?: AbortSignal } = {}
): Promise<void> {
  const service = await localAddresses()
  if (signal?.aborted) return
  if (service) {
    const result = await saveLocalAddress(
      downloadAddress(service, file, opened),
      { signal }
    )
    if (result !== 'unavailable') return
  }
  saveDecrypted(
    await fetchDecrypted(file, opened, { download: true, signal }),
    opened.name
  )
}
