import {
  LOCAL_ADDRESS_PREFIX,
  type PageMessage,
  type WorkerMessage,
} from './protocol'
import { type ServicePort, createLocalAddressService } from './service'

/**
 * The service worker of the application (docs/e2ee-spec.md, section 12.2).
 * It answers local addresses with decrypted bytes and does nothing else:
 *
 * - It has no cache. It never calls `caches`, and it stores nothing.
 * - It leaves every request that is not a local address to the network:
 *   pages, the API, static files and other origins. Where the browser has
 *   static routing, those requests do not even start the worker.
 * - Keys are in memory only. The browser stops an idle worker after about
 *   30 seconds, and the keys go with it. The page registers them again
 *   when the worker asks (`flare-local-need`).
 */
interface WorkerClient {
  readonly id: string
  postMessage(message: WorkerMessage): void
}

interface ExtendableEvent {
  waitUntil(work: Promise<unknown>): void
}

interface InstallEvent extends ExtendableEvent {
  addRoutes?(rules: unknown): Promise<void>
}

interface MessageEventLike extends ExtendableEvent {
  readonly data: unknown
  readonly source: { readonly id?: string } | null
  readonly ports: readonly ServicePort[]
}

interface FetchEventLike extends ExtendableEvent {
  readonly request: Request
  readonly clientId: string
  respondWith(response: Promise<Response>): void
}

interface WorkerScope {
  readonly location: { readonly origin: string }
  readonly clients: {
    get(id: string): Promise<WorkerClient | undefined>
    matchAll(options: {
      type: 'window'
      includeUncontrolled: boolean
    }): Promise<WorkerClient[]>
    claim(): Promise<void>
  }
  skipWaiting(): Promise<void>
  addEventListener(
    type: 'install',
    listener: (event: InstallEvent) => void
  ): void
  addEventListener(
    type: 'activate',
    listener: (event: ExtendableEvent) => void
  ): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEventLike) => void
  ): void
  addEventListener(
    type: 'fetch',
    listener: (event: FetchEventLike) => void
  ): void
}

const scope = globalThis as unknown as WorkerScope

async function windows() {
  return scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

const service = createLocalAddressService({
  origin: scope.location.origin,
  fetch: (url, init) => fetch(url, init),
  notify(clientId, message) {
    void (async () => {
      const targets = clientId
        ? [await scope.clients.get(clientId)]
        : await windows()
      for (const target of targets) target?.postMessage(message)
    })().catch(() => undefined)
  },
})

scope.addEventListener('install', (event) => {
  // Only local addresses reach the fetch handler below. Each other request
  // goes to the network without starting this worker.
  if (event.addRoutes)
    event.waitUntil(
      event
        .addRoutes([
          {
            condition: {
              not: { urlPattern: `${LOCAL_ADDRESS_PREFIX}*` },
            },
            source: 'network',
          },
        ])
        .catch(() => undefined)
    )
  // A new version replaces the old one at once. The old one's keys are in
  // memory only, and its pages register them again when asked.
  event.waitUntil(scope.skipWaiting())
})

scope.addEventListener('activate', (event) => {
  event.waitUntil(scope.clients.claim())
})

scope.addEventListener('message', (event) => {
  const message = event.data as PageMessage | null
  const clientId = event.source?.id ?? ''
  if (!message || typeof message !== 'object') return
  if (message.type === 'flare-local-register') {
    service.register(message.resource, clientId, event.ports[0] ?? null)
    // Pages that are gone took their addresses with them.
    event.waitUntil(
      windows().then((clients) =>
        service.keepOnly(new Set(clients.map((client) => client.id)))
      )
    )
  } else if (message.type === 'flare-local-release')
    service.release(message.tokens, clientId)
  else if (message.type === 'flare-local-drop-all') service.dropAll()
})

scope.addEventListener('fetch', (event) => {
  const response = service.handle(event.request, event.clientId)
  // No `respondWith`: the browser handles the request as if no worker ran.
  if (response) event.respondWith(response)
})
