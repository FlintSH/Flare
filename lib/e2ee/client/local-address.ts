import { base64urlEncode, wipe } from '../primitives'
import {
  type LocalFailure,
  type LocalResource,
  type PageMessage,
  type PortMessage,
  type WorkerMessage,
  localAddressPath,
} from '../sw/protocol'

/**
 * The page's side of local addresses (docs/e2ee-spec.md, section 12.2).
 *
 * The page makes the address and keeps what it stands for: the key of the
 * file, its header and its size. The service worker gets a copy over a
 * `MessageChannel` and holds it in memory. The browser stops an idle
 * worker, so the worker can ask for an address again at any time
 * (`flare-local-need`), and the page answers from this list.
 *
 * Nothing here is written to storage. `dropLocalAddresses` erases every key
 * of this page and tells the worker to forget every key it holds.
 */

/** A feed: the page gives the bytes of a download, one piece for each pull. */
export type LocalFeed = AsyncIterator<Uint8Array, unknown, undefined>

interface Registered {
  readonly resource: LocalResource
  readonly feed: LocalFeed | null
  readonly watchers: Set<(event: LocalAddressEvent) => void>
}

export type LocalAddressEvent =
  | { readonly type: 'started' }
  | { readonly type: 'finished' }
  | { readonly type: 'failed'; readonly reason: LocalFailure | 'cancelled' }

export interface LocalAddress {
  /** `/_flare/local/{token}`. Give it to a media element or a frame. */
  readonly url: string
  /** Resolves when the worker holds the address. Rejects if it refused it. */
  readonly registered: Promise<void>
  /** Sends the address to the worker again, after a request for it failed. */
  refresh(): Promise<void>
  /** What the worker reports about requests for this address. */
  watch(listener: (event: LocalAddressEvent) => void): () => void
  /** Erases the key here and in the worker. */
  release(): void
}

export interface LocalAddresses {
  create(resource: Omit<LocalResource, 'token'>, feed?: LocalFeed): LocalAddress
}

const registry = new Map<string, Registered>()
let service: Promise<LocalAddresses | null> | null = null
let listening = false

const START_WAIT_MS = 6000
const CONTROL_WAIT_MS = 4000
const REGISTER_WAIT_MS = 4000

function container(): ServiceWorkerContainer | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return null
  // Insecure origins and some private windows have no service workers.
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null
  try {
    // A sandboxed document throws here.
    return navigator.serviceWorker ?? null
  } catch {
    return null
  }
}

/** `work`, or null when it takes longer than a person should wait for it. */
function within<Result>(work: Promise<Result>, ms: number) {
  return new Promise<Result | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms)
    work.then(
      (result) => {
        window.clearTimeout(timer)
        resolve(result)
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

function post(message: PageMessage, transfer: Transferable[] = []) {
  container()?.controller?.postMessage(message, transfer)
}

function emit(token: string, event: LocalAddressEvent) {
  for (const watch of registry.get(token)?.watchers ?? []) watch(event)
}

function sourceKeys(resource: LocalResource): Uint8Array[] {
  return resource.source.kind === 'file' ? [resource.source.fileKey] : []
}

/** Gives one address to the worker. The reply and a feed use the port. */
function send(entry: Registered): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(
      () => reject(new Error('The service worker did not answer')),
      REGISTER_WAIT_MS
    )
    let pulling = false
    channel.port1.onmessage = (event: MessageEvent<PortMessage>) => {
      const message = event.data
      if (message.type === 'registered') {
        window.clearTimeout(timer)
        resolve()
      } else if (message.type === 'refused') {
        window.clearTimeout(timer)
        reject(new Error(message.reason))
      } else if (message.type === 'pull' && entry.feed && !pulling) {
        pulling = true
        entry.feed.next().then(
          (step) => {
            pulling = false
            if (step.done) channel.port1.postMessage({ type: 'end' })
            else
              channel.port1.postMessage({ type: 'chunk', bytes: step.value }, [
                step.value.buffer as ArrayBuffer,
              ])
          },
          () => {
            pulling = false
            channel.port1.postMessage({ type: 'error' })
          }
        )
      } else if (message.type === 'cancel')
        void entry.feed?.return?.(undefined)?.catch(() => undefined)
    }
    post({ type: 'flare-local-register', resource: entry.resource }, [
      channel.port2,
    ])
  })
}

function listen(workers: ServiceWorkerContainer) {
  if (listening) return
  listening = true
  workers.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as WorkerMessage | null
    if (!message || typeof message !== 'object') return
    const entry = registry.get(message.token)
    if (!entry) return
    if (message.type === 'flare-local-need')
      // A feed cannot start again: its bytes were given out already.
      void (entry.feed ? Promise.resolve() : send(entry)).catch(() => undefined)
    else if (message.type === 'flare-local-failed')
      emit(message.token, { type: 'failed', reason: message.reason })
    else if (message.type === 'flare-local-started')
      emit(message.token, { type: 'started' })
    else if (message.type === 'flare-local-finished')
      emit(message.token, { type: 'finished' })
  })
  workers.startMessages()
}

async function start(): Promise<LocalAddresses | null> {
  const workers = container()
  if (!workers) return null
  // A registration that is refused, blocked, or never becomes active (a
  // browser setting, a missing `Service-Worker-Allowed` header behind a
  // proxy) must not keep a file from opening: the caller falls back.
  const active = await within(
    (async () => {
      // Written out in full: the bundler builds the worker from this exact
      // call, as one file at /_next/static/service-worker/sw.js.
      await navigator.serviceWorker.register(
        new URL('../sw/local.sw.ts', import.meta.url),
        { scope: '/' }
      )
      return workers.ready
    })(),
    START_WAIT_MS
  )
  if (!active) return null
  if (!workers.controller) {
    // A first visit: the worker claims the page a moment after it starts.
    // A page that the user reloaded with the cache bypassed is never
    // controlled, and then there are no local addresses.
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, CONTROL_WAIT_MS)
      workers.addEventListener(
        'controllerchange',
        () => {
          window.clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })
    if (!workers.controller) return null
  }
  listen(workers)
  return {
    create(input, feed) {
      const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
      const resource = {
        ...input,
        token,
        // A copy that lives as long as the address, for the worker that
        // starts again without it.
        source:
          input.source.kind === 'file'
            ? {
                ...input.source,
                fileKey: input.source.fileKey.slice(),
                header: input.source.header.slice(),
              }
            : input.source,
      } satisfies LocalResource
      const entry: Registered = {
        resource,
        feed: feed ?? null,
        watchers: new Set(),
      }
      registry.set(token, entry)
      const registered = send(entry)
      // A caller that does not wait must not get an unhandled rejection.
      registered.catch(() => undefined)
      return {
        url: localAddressPath(token),
        registered,
        refresh: () => send(entry),
        watch(listener) {
          entry.watchers.add(listener)
          return () => {
            entry.watchers.delete(listener)
          }
        },
        release() {
          if (!registry.delete(token)) return
          wipe(...sourceKeys(resource))
          post({ type: 'flare-local-release', tokens: [token] })
        },
      }
    },
  }
}

/**
 * The local addresses of this browser, or null where there is no service
 * worker: an insecure origin, a private window of some browsers, a page
 * loaded with the cache bypassed, or a blocked registration. A caller then
 * downloads and decrypts the whole file, as section 12.2 says.
 */
export function localAddresses(): Promise<LocalAddresses | null> {
  service ??= start().then((result) => {
    // A browser that had no worker this time may have one the next time.
    if (!result) service = null
    return result
  })
  return service
}

/**
 * Sign-out, lock or a different account: every key this page gave to an
 * address is erased, and the worker forgets every key it holds, also those
 * of other pages. A page that still shows a file registers it again when
 * its player asks.
 */
export function dropLocalAddresses() {
  for (const entry of registry.values()) {
    wipe(...sourceKeys(entry.resource))
    for (const watch of entry.watchers)
      watch({ type: 'failed', reason: 'cancelled' })
  }
  registry.clear()
  post({ type: 'flare-local-drop-all' })
}
