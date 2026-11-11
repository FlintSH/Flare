import { parseByteRange } from '@/lib/http/byte-range'

import {
  type EncryptedSource,
  SourceError,
  type SourceFetch,
  openEncryptedSource,
  probeStoredLength,
} from '../client/encrypted-source'
import { DamagedEntry, type PlainView, plainView } from '../client/plain-view'
import { isE2eeError } from '../errors'
import { parseHeader } from '../file'
import { constantTimeEqual, wipe } from '../primitives'
import {
  type LocalFailure,
  type LocalMember,
  type LocalMode,
  type LocalResource,
  type PortMessage,
  type WorkerMessage,
  guardHeaders,
  isLocalToken,
  localAddressToken,
  localAnswer,
  localContentType,
  requestAllowed,
  unsatisfiableHeaders,
} from './protocol'

/**
 * The service worker's answers for local addresses (docs/e2ee-spec.md,
 * section 12.2), without the worker around it: a test gives it a fake
 * `fetch` and plain requests.
 *
 * `file_key` exists here only as the content keys of an open source, in
 * memory. Nothing is written to Cache Storage, IndexedDB or a URL. A worker
 * that the browser stopped starts again with nothing: `handle` then asks
 * the page that owns the address, and the page registers it again.
 */

export interface ServicePort {
  postMessage(message: PortMessage): void
  onmessage: ((event: { data: unknown }) => void) | null
  close?(): void
}

export interface ServiceEnvironment {
  /** The origin of the application. Only its own addresses are answered. */
  readonly origin: string
  readonly fetch: SourceFetch
  /** To one client, or to every window of the origin when `clientId` is empty. */
  notify(clientId: string, message: WorkerMessage): void
  /** How long a request waits for the page to register its address. */
  readonly waitMs?: number
}

/** What `handle` reads of a request. A `Request` fits. */
export interface ServiceRequest {
  readonly url: string
  readonly method: string
  readonly mode: string
  readonly destination: string
  readonly headers: { get(name: string): string | null }
}

interface Opened {
  readonly source: EncryptedSource
  readonly view: PlainView
}

/**
 * One file that addresses read from. Several addresses of one file, such as
 * the entries of an archive, share its keys and the proof of its length.
 */
interface SharedFile {
  readonly url: string
  readonly fileKey: Uint8Array
  readonly header: Uint8Array
  readonly storedLength?: number
  addresses: number
  source: Promise<EncryptedSource> | null
  closed: boolean
}

interface Held {
  readonly token: string
  readonly mode: LocalMode
  readonly contentType: string
  readonly filename?: string
  readonly clientId: string
  readonly countDownload: boolean
  /** A file source. Opened at the first request, then kept. */
  readonly file: {
    readonly shared: SharedFile
    readonly member?: LocalMember
  } | null
  /** A feed source. */
  readonly port: ServicePort | null
  /** A download and a feed answer one request. */
  used: boolean
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && constantTimeEqual(left, right)
}

const MODES: readonly LocalMode[] = ['media', 'frame', 'download']
const DEFAULT_WAIT_MS = 5000
/**
 * A range that starts deeper than this in compressed data is answered with
 * the whole entry: every byte before it would be decoded and thrown away.
 */
export const DISCARD_LIMIT_BYTES = 256 * 1024 * 1024

function refusal(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { ...guardHeaders(), 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function failureOf(error: unknown): LocalFailure {
  if (isE2eeError(error) || error instanceof DamagedEntry) return 'integrity'
  if (error instanceof SourceError && error.failure !== 'network')
    return error.failure === 'refused' ? 'refused' : 'integrity'
  return 'network'
}

export function createLocalAddressService(environment: ServiceEnvironment) {
  const held = new Map<string, Held>()
  const waiting = new Map<string, Set<(resource: Held | null) => void>>()

  const files: SharedFile[] = []

  /** The shared file of a registration: an open one with the same key, or a new one. */
  function share(file: {
    url: string
    fileKey: Uint8Array
    header: Uint8Array
    storedLength?: number
  }): SharedFile {
    let shared = files.find(
      (known) =>
        known.url === file.url &&
        known.storedLength === file.storedLength &&
        sameBytes(known.header, file.header) &&
        sameBytes(known.fileKey, file.fileKey)
    )
    if (!shared) {
      shared = {
        url: file.url,
        fileKey: file.fileKey.slice(),
        header: file.header.slice(),
        storedLength: file.storedLength,
        addresses: 0,
        source: null,
        closed: false,
      }
      files.push(shared)
    }
    shared.addresses++
    return shared
  }

  function forget(token: string) {
    const resource = held.get(token)
    if (!resource) return
    held.delete(token)
    resource.port?.close?.()
    const shared = resource.file?.shared
    if (!shared || --shared.addresses > 0) return
    // The last address of the file: its keys go, and a transfer that still
    // reads from it stops.
    shared.closed = true
    files.splice(files.indexOf(shared), 1)
    wipe(shared.fileKey)
    void shared.source?.then(
      (source) => source.close(),
      () => undefined
    )
  }

  /** Opens the source of a file resource once: its length, then its keys. */
  async function open(resource: Held): Promise<Opened> {
    const { shared, member } = resource.file!
    shared.source ??= (async () => {
      const storedLength =
        shared.storedLength ??
        (await probeStoredLength({
          url: shared.url,
          header: shared.header,
          fetch: environment.fetch,
        }))
      if (shared.closed) throw new Error('The address was released')
      return openEncryptedSource({
        url: shared.url,
        fileKey: shared.fileKey,
        header: shared.header,
        storedLength,
        fetch: environment.fetch,
      })
    })().catch((error: unknown) => {
      // A request that failed can be made again.
      shared.source = null
      throw error
    })
    const source = await shared.source
    return { source, view: plainView(source, member) }
  }

  /** Reads a registration. Throws with a reason that names no secret. */
  function accept(
    input: unknown,
    clientId: string,
    port: ServicePort | null
  ): Held {
    const resource = input as Partial<LocalResource> | null
    if (!resource || typeof resource !== 'object')
      throw new Error('Not a resource')
    const { token, mode, source } = resource
    if (!isLocalToken(token)) throw new Error('Not a valid address')
    if (!clientId) throw new Error('No page owns this address')
    if (!mode || !MODES.includes(mode)) throw new Error('Not a valid mode')
    const contentType = localContentType(mode, resource.contentType)
    if (!contentType) throw new Error('This type has no local address')
    const existing = held.get(token)
    if (existing && existing.clientId !== clientId)
      throw new Error('The address belongs to another page')
    const filename =
      typeof resource.filename === 'string'
        ? resource.filename.slice(0, 1024)
        : undefined
    if (!source || typeof source !== 'object') throw new Error('No source')
    const common = {
      token,
      mode,
      contentType,
      filename,
      clientId,
      countDownload: resource.countDownload === true,
      used: false,
    }
    if (source.kind === 'feed') {
      if (mode !== 'download' || !port)
        throw new Error('Only a download can be fed by its page')
      return { ...common, file: null, port }
    }
    if (source.kind !== 'file') throw new Error('Not a valid source')
    // The worker reads ciphertext of the application's files and nothing
    // else: it must not become a way to fetch any address.
    let url: URL
    try {
      url = new URL(String(source.url), environment.origin)
    } catch {
      throw new Error('Not a valid file address')
    }
    if (
      url.origin !== environment.origin ||
      !url.pathname.startsWith('/api/files/') ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('Not a file address of this application')
    if (
      !(source.fileKey instanceof Uint8Array) ||
      source.fileKey.length !== 32 ||
      !(source.header instanceof Uint8Array)
    )
      throw new Error('Not a valid key or header')
    if (
      source.storedLength !== undefined &&
      !Number.isSafeInteger(source.storedLength)
    )
      throw new Error('Not a valid length')
    // Refuses a header of a version or chunk size this worker does not know.
    parseHeader(source.header)
    // The values of an entry are checked against the file when it opens.
    return {
      ...common,
      file: {
        shared: share({
          url: url.pathname,
          fileKey: source.fileKey,
          header: source.header,
          storedLength: source.storedLength,
        }),
        member: source.member,
      },
      port: null,
    }
  }

  function register(
    input: unknown,
    clientId: string,
    port: ServicePort | null
  ) {
    let resource: Held
    try {
      resource = accept(input, clientId, port)
    } catch (error) {
      port?.postMessage({
        type: 'refused',
        reason: error instanceof Error ? error.message : 'Refused',
      })
      return false
    }
    forget(resource.token)
    held.set(resource.token, resource)
    for (const resolve of waiting.get(resource.token) ?? []) resolve(resource)
    waiting.delete(resource.token)
    port?.postMessage({ type: 'registered' })
    return true
  }

  async function find(token: string, clientId: string): Promise<Held | null> {
    const known = held.get(token)
    if (known) return known
    // The worker was stopped since the page registered this address, or the
    // request came before the registration. The page has the key.
    return new Promise<Held | null>((resolve) => {
      const waiters = waiting.get(token) ?? new Set()
      waiting.set(token, waiters)
      const timer = setTimeout(() => {
        waiters.delete(settle)
        if (!waiters.size) waiting.delete(token)
        resolve(null)
      }, environment.waitMs ?? DEFAULT_WAIT_MS)
      const settle = (resource: Held | null) => {
        clearTimeout(timer)
        resolve(resource)
      }
      waiters.add(settle)
      environment.notify(clientId, { type: 'flare-local-need', token })
    })
  }

  /** The bytes of a `feed` source, pulled from the page one piece at a time. */
  function feedBody(resource: Held): ReadableStream<Uint8Array> {
    const port = resource.port!
    let waitingPull: {
      resolve: () => void
      reject: (error: Error) => void
    } | null = null
    return new ReadableStream<Uint8Array>({
      start(controller) {
        port.onmessage = ({ data }) => {
          const message = data as PortMessage
          const pull = waitingPull
          waitingPull = null
          if (message.type === 'chunk' && message.bytes instanceof Uint8Array) {
            controller.enqueue(message.bytes)
            pull?.resolve()
          } else if (message.type === 'end') {
            controller.close()
            forget(resource.token)
            environment.notify(resource.clientId, {
              type: 'flare-local-finished',
              token: resource.token,
            })
            pull?.resolve()
          } else if (message.type === 'error') {
            const error = new Error('The page stopped the download')
            controller.error(error)
            forget(resource.token)
            environment.notify(resource.clientId, {
              type: 'flare-local-failed',
              token: resource.token,
              reason: 'network',
            })
            pull?.reject(error)
          }
        }
      },
      pull() {
        return new Promise<void>((resolve, reject) => {
          waitingPull = { resolve, reject }
          port.postMessage({ type: 'pull' })
        })
      },
      cancel() {
        port.postMessage({ type: 'cancel' })
        forget(resource.token)
        environment.notify(resource.clientId, {
          type: 'flare-local-failed',
          token: resource.token,
          reason: 'cancelled',
        })
      },
    })
  }

  /** The answer when no byte could be given, and the reason for the page. */
  function failed(resource: Held, error: unknown): Response {
    const reason = failureOf(error)
    environment.notify(resource.clientId, {
      type: 'flare-local-failed',
      token: resource.token,
      reason,
    })
    return refusal(
      reason === 'refused'
        ? error instanceof SourceError && error.status === 404
          ? 404
          : 403
        : 502,
      reason === 'integrity'
        ? 'This file did not pass its integrity check.'
        : 'This file could not be read.'
    )
  }

  async function answer(
    resource: Held,
    request: ServiceRequest
  ): Promise<Response> {
    if (resource.mode === 'download') {
      if (resource.used) return refusal(410, 'This download was used.')
      resource.used = true
    }
    if (!resource.file) {
      const { headers } = localAnswer({
        mode: resource.mode,
        contentType: resource.contentType,
        filename: resource.filename,
        length: 0,
        start: 0,
        end: 0,
        ranged: false,
      })
      // The length of a fed stream is not known before its end.
      delete headers['Content-Length']
      environment.notify(resource.clientId, {
        type: 'flare-local-started',
        token: resource.token,
      })
      return new Response(feedBody(resource), { status: 200, headers })
    }
    let opened: Opened
    try {
      opened = await open(resource)
    } catch (error) {
      return failed(resource, error)
    }
    const { view, source } = opened
    const whole = resource.mode === 'frame' || resource.mode === 'download'
    let range = whole
      ? null
      : parseByteRange(request.headers.get('range'), view.length)
    if (range === 'unsatisfiable')
      return new Response(null, {
        status: 416,
        headers: unsatisfiableHeaders(view.length),
      })
    // HTTP lets a server ignore `Range`: the reader gets the whole entry.
    if (range && view.discardedBefore(range.start) > DISCARD_LIMIT_BYTES)
      range = null
    const start = range?.start ?? 0
    const end = range ? range.end + 1 : view.length
    const { status, headers } = localAnswer({
      mode: resource.mode,
      contentType: resource.contentType,
      filename: resource.filename,
      length: view.length,
      start,
      end,
      ranged: range !== null,
    })
    if (request.method === 'HEAD')
      return new Response(null, { status, headers })

    const abort = new AbortController()
    const fail = (error: unknown) => {
      if (abort.signal.aborted) return
      environment.notify(resource.clientId, {
        type: 'flare-local-failed',
        token: resource.token,
        reason: failureOf(error),
      })
    }
    // The stored length is the server's word. Before any byte is given out
    // as part of the file, the final chunk proves it (section 7.4).
    let pieces: AsyncGenerator<Uint8Array, void, undefined>
    let first: IteratorResult<Uint8Array, void>
    try {
      await source.verifyEnd(abort.signal)
      pieces = view.stream(start, end, {
        signal: abort.signal,
        window: whole ? 'whole' : 'adaptive',
        countDownload: resource.mode === 'download' && resource.countDownload,
      })
      // The first piece is read before the headers leave, so a refused or
      // changed file is an error status and not a cut-off body.
      first = await pieces.next()
    } catch (error) {
      return failed(resource, error)
    }
    const download = resource.mode === 'download'
    const done = (finished: boolean) => {
      if (!download) return
      forget(resource.token)
      if (finished)
        environment.notify(resource.clientId, {
          type: 'flare-local-finished',
          token: resource.token,
        })
    }
    if (download)
      environment.notify(resource.clientId, {
        type: 'flare-local-started',
        token: resource.token,
      })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.done) {
          controller.close()
          done(true)
        } else controller.enqueue(first.value)
      },
      async pull(controller) {
        try {
          const step = await pieces.next()
          if (step.done) {
            controller.close()
            done(true)
          } else controller.enqueue(step.value)
        } catch (error) {
          // A failed tag in the middle: the reader gets a broken transfer,
          // never bytes that did not verify and never a clean end.
          fail(error)
          controller.error(error)
          done(false)
        }
      },
      cancel() {
        if (download)
          environment.notify(resource.clientId, {
            type: 'flare-local-failed',
            token: resource.token,
            reason: 'cancelled',
          })
        abort.abort()
        void pieces.return(undefined).catch(() => undefined)
        done(false)
      },
    })
    return new Response(body, { status, headers })
  }

  return {
    register,
    release(tokens: unknown, clientId: string) {
      if (!Array.isArray(tokens)) return
      for (const token of tokens)
        if (typeof token === 'string' && held.get(token)?.clientId === clientId)
          forget(token)
    },
    /** Sign-out or lock in any page: no key stays in this worker. */
    dropAll() {
      for (const token of [...held.keys()]) forget(token)
    },
    /** Forgets what pages that are gone had registered. */
    keepOnly(clientIds: ReadonlySet<string>) {
      for (const [token, resource] of held)
        if (!clientIds.has(resource.clientId)) forget(token)
    },
    get size() {
      return held.size
    },
    /**
     * The answer for a local address, or null for each other request, which
     * the worker must leave to the network untouched.
     */
    handle(
      request: ServiceRequest,
      clientId: string
    ): Promise<Response> | null {
      let url: URL
      try {
        url = new URL(request.url)
      } catch {
        return null
      }
      if (url.origin !== environment.origin) return null
      const token = localAddressToken(url.pathname)
      if (token === null) return null
      return (async () => {
        if (!token) return refusal(404, 'Not found.')
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return refusal(405, 'Method not allowed.')
        const resource = await find(token, clientId)
        if (!resource) return refusal(404, 'Not found.')
        if (
          !requestAllowed(resource, {
            mode: request.mode,
            destination: request.destination,
            clientId,
          })
        )
          return refusal(403, 'This address belongs to another page.')
        return answer(resource, request)
      })()
    },
  }
}

export type LocalAddressService = ReturnType<typeof createLocalAddressService>
