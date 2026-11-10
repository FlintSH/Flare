import {
  DOWNLOAD_BLOB_TYPE,
  LOCAL_FRAME_TYPE,
  LOCAL_MEDIA_TYPES,
  safeFileName,
} from '@/lib/files/safe-render'

/**
 * What the page and the service worker say to each other about local
 * addresses (docs/e2ee-spec.md, section 12.2), and the rules for what such
 * an address may answer. Pure: the page, the worker and the tests share it.
 *
 * A local address is `/_flare/local/{token}`. No request for it reaches the
 * server while the worker runs: the worker answers with bytes it decrypts.
 * Those bytes are not trusted. A person who knows an account public key can
 * make a file that decrypts correctly (section 3.3, limit 2), so the answer
 * must never become a page of this origin. The rules:
 *
 * - `media`: an `<img>`, `<video>` or `<audio>` of the page that registered
 *   the address. Only the exact types of `LOCAL_MEDIA_TYPES`. A navigation
 *   is refused.
 * - `frame`: a PDF in a frame. Only `application/pdf`. The answer has a
 *   sandbox policy, so the document has an opaque origin.
 * - `download`: saved to disk. Always `application/octet-stream` and
 *   `Content-Disposition: attachment`. One use.
 * - `data`: read by script of the page that registered it (a text preview
 *   of an archive entry). Always `application/octet-stream`. A navigation
 *   is refused.
 *
 * Every answer has `X-Content-Type-Options: nosniff` and
 * `Content-Security-Policy: sandbox; default-src 'none'`.
 */

/** No URL ID and no vanity ID can contain `_`, so no file page has this path. */
export const LOCAL_ADDRESS_PREFIX = '/_flare/local/'

/** 32 random bytes as base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export type LocalMode = 'media' | 'frame' | 'download' | 'data'

/** A part of the plaintext of a file: one entry of an archive. */
export type LocalMember =
  /** Bytes as they are: a TAR entry or a stored ZIP entry. */
  | {
      readonly kind: 'stored'
      readonly offset: number
      readonly length: number
    }
  /** A deflated ZIP entry. `length` is the size after inflation. */
  | {
      readonly kind: 'deflate'
      readonly offset: number
      readonly compressedLength: number
      readonly length: number
      readonly crc32?: number
    }
  /** Bytes of the stream that gzip decoding of the whole file gives. */
  | { readonly kind: 'gzip'; readonly offset: number; readonly length: number }

export type LocalSource =
  | {
      readonly kind: 'file'
      /** The ciphertext address. Same origin, under `/api/files/`. */
      readonly url: string
      readonly fileKey: Uint8Array
      readonly header: Uint8Array
      /** As the server reports it. Absent: the worker asks the server. */
      readonly storedLength?: number
      readonly member?: LocalMember
    }
  /** The page sends the bytes over the registration port (the export). */
  | { readonly kind: 'feed' }

export interface LocalResource {
  readonly token: string
  readonly mode: LocalMode
  /** The claimed type. The worker keeps it only if the mode allows it. */
  readonly contentType: string
  /** For a download. Not trusted: the worker cleans it. */
  readonly filename?: string
  readonly source: LocalSource
  /** The one streaming request of a download adds to the download count. */
  readonly countDownload?: boolean
}

export type PageMessage =
  | { readonly type: 'flare-local-register'; readonly resource: LocalResource }
  | { readonly type: 'flare-local-release'; readonly tokens: readonly string[] }
  /** Sign-out or lock: the worker forgets every key it holds. */
  | { readonly type: 'flare-local-drop-all' }

export type WorkerMessage =
  /** The worker has no resource for this address and asks the page. */
  | { readonly type: 'flare-local-need'; readonly token: string }
  /** A request for this address failed, with a reason a page can show. */
  | {
      readonly type: 'flare-local-failed'
      readonly token: string
      readonly reason: LocalFailure
    }
  /** The answer to a download began: the browser is saving it. */
  | { readonly type: 'flare-local-started'; readonly token: string }
  /** Every byte of a download was given to the browser. */
  | { readonly type: 'flare-local-finished'; readonly token: string }

export type LocalFailure =
  /** A tag did not match, or the file is not the one the page opened. */
  | 'integrity'
  /** The server did not send the file. */
  | 'refused'
  | 'network'
  /** The reader stopped: a person cancelled the download. */
  | 'cancelled'

/** Over the registration port, both ways. */
export type PortMessage =
  | { readonly type: 'registered' }
  | { readonly type: 'refused'; readonly reason: string }
  // A `feed` source: the worker pulls, the page answers.
  | { readonly type: 'pull' }
  | { readonly type: 'cancel' }
  | { readonly type: 'chunk'; readonly bytes: Uint8Array }
  | { readonly type: 'end' }
  | { readonly type: 'error' }

export function isLocalToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN.test(token)
}

export function localAddressPath(token: string): string {
  return `${LOCAL_ADDRESS_PREFIX}${token}`
}

/** The token of a local address path, or null for each other path. */
export function localAddressToken(pathname: string): string | null {
  if (!pathname.startsWith(LOCAL_ADDRESS_PREFIX)) return null
  const token = pathname.slice(LOCAL_ADDRESS_PREFIX.length)
  return isLocalToken(token) ? token : ''
}

/**
 * The type an address of this mode answers with, or null if the mode does
 * not serve the claimed type. The result is always a fixed text from the
 * allowlist, never the claimed text.
 */
export function localContentType(
  mode: LocalMode,
  claimed: unknown
): string | null {
  if (mode === 'download' || mode === 'data') return DOWNLOAD_BLOB_TYPE
  if (typeof claimed !== 'string') return null
  if (mode === 'frame') return claimed === LOCAL_FRAME_TYPE ? claimed : null
  return LOCAL_MEDIA_TYPES.has(claimed) ? claimed : null
}

/** What a request must look like for its mode. */
export interface LocalRequestShape {
  /** `request.mode`: `navigate` for a navigation. */
  readonly mode: string
  /** `request.destination`. */
  readonly destination: string
  /** The client that sent the request. Empty for a navigation. */
  readonly clientId: string
}

const MEDIA_DESTINATIONS = new Set(['image', 'video', 'audio', 'track'])

/**
 * Whether a request may get the resource. A subresource request must come
 * from the page that registered the address. A navigation has no client, so
 * only the modes that are safe as a navigation accept one: a download, which
 * the browser saves, and a PDF in a frame, which has an opaque origin.
 */
export function requestAllowed(
  resource: { readonly mode: LocalMode; readonly clientId: string },
  request: LocalRequestShape
): boolean {
  const navigation = request.mode === 'navigate'
  switch (resource.mode) {
    case 'media':
      return (
        !navigation &&
        request.clientId === resource.clientId &&
        MEDIA_DESTINATIONS.has(request.destination)
      )
    case 'data':
      return (
        !navigation &&
        request.clientId === resource.clientId &&
        request.destination === ''
      )
    case 'frame':
      return navigation && request.destination === 'iframe'
    case 'download':
      return navigation
  }
}

const SANDBOX_POLICY = "sandbox; default-src 'none'"

function dispositionName(name: string) {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encoded}`
}

/** The headers of every answer, an error included. */
export function guardHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': SANDBOX_POLICY,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
}

export interface LocalAnswer {
  readonly status: 200 | 206
  readonly headers: Record<string, string>
}

/**
 * The status and headers for the bytes `[start, end)` of a resource of
 * `length` bytes. `ranged` is false when the request had no usable `Range`.
 */
export function localAnswer(input: {
  readonly mode: LocalMode
  readonly contentType: string
  readonly filename?: string
  readonly length: number
  readonly start: number
  readonly end: number
  readonly ranged: boolean
}): LocalAnswer {
  const type = localContentType(input.mode, input.contentType)
  if (!type) throw new Error('This type has no local address')
  const attachment = input.mode === 'download' || input.mode === 'data'
  const headers: Record<string, string> = {
    ...guardHeaders(),
    'Content-Type': type,
    'Content-Disposition': attachment
      ? `attachment; ${dispositionName(safeFileName(input.filename))}`
      : 'inline',
    'Content-Length': String(input.end - input.start),
  }
  // A frame reads the whole document in one answer and must not ask again.
  if (input.mode !== 'frame' && input.mode !== 'download')
    headers['Accept-Ranges'] = 'bytes'
  if (input.ranged)
    headers['Content-Range'] =
      `bytes ${input.start}-${input.end - 1}/${input.length}`
  return { status: input.ranged ? 206 : 200, headers }
}

/** The answer when the range is outside the resource. */
export function unsatisfiableHeaders(length: number): Record<string, string> {
  return {
    ...guardHeaders(),
    'Content-Range': `bytes */${length}`,
    'Accept-Ranges': 'bytes',
  }
}
