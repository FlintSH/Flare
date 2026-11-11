import { isE2eeError } from '../errors'
import { wipe } from '../primitives'
import type { FileKey, HeaderHash } from '../types'
import { openSealedThumbnail } from './files'

/**
 * Opens sealed thumbnails off the page's thread (docs/e2ee-spec.md, section
 * 12.1), so a library full of cards stays responsive. One worker serves
 * every card. It fetches the ciphertext itself and gives back the bytes of
 * the image, or nothing when the file has no thumbnail or the record does
 * not open. Nothing is written to any storage.
 */
export type ThumbnailWorkerRequest = {
  id: number
  url: string
  fileKey: Uint8Array
  headerHash: Uint8Array
}

export type ThumbnailWorkerResponse =
  | { id: number; bytes: Uint8Array }
  /** `none`: no thumbnail is stored. `failed`: it did not load or did not open. */
  | { id: number; bytes: null; reason: 'none' | 'failed' }

interface WorkerScope {
  onmessage: ((event: MessageEvent<ThumbnailWorkerRequest>) => void) | null
  postMessage(message: ThumbnailWorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

async function open(request: ThumbnailWorkerRequest) {
  const fileKey = request.fileKey as FileKey
  try {
    const response = await fetch(request.url, { credentials: 'same-origin' })
    if (response.status === 204) return 'none' as const
    if (!response.ok) return 'failed' as const
    return openSealedThumbnail(
      { fileKey, headerHash: request.headerHash as HeaderHash },
      new Uint8Array(await response.arrayBuffer())
    )
  } catch (error) {
    if (!isE2eeError(error) && !(error instanceof TypeError)) throw error
    return 'failed' as const
  } finally {
    wipe(fileKey)
  }
}

scope.onmessage = (event) => {
  const request = event.data
  void open(request)
    .catch(() => 'failed' as const)
    .then((result) => {
      if (typeof result === 'string')
        scope.postMessage({ id: request.id, bytes: null, reason: result })
      else
        scope.postMessage({ id: request.id, bytes: result }, [
          result.buffer as ArrayBuffer,
        ])
    })
}
