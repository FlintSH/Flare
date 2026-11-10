import { wasmArgon2id } from './argon2-wasm'

/**
 * The worker of `workerArgon2id`. It gets one request, answers one time and
 * is terminated by the page. The password bytes arrive as a transferred
 * buffer, so this worker holds the only copy and overwrites it.
 */
export interface Argon2WorkerRequest {
  password: Uint8Array
  salt: Uint8Array
  memoryKib: number
  passes: number
  lanes: number
  outputLength: number
}

export type Argon2WorkerResponse =
  { ok: true; output: Uint8Array } | { ok: false }

interface WorkerScope {
  onmessage: ((event: MessageEvent<Argon2WorkerRequest>) => void) | null
  postMessage(message: Argon2WorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = async (event) => {
  const request = event.data
  try {
    const output = await wasmArgon2id(request)
    scope.postMessage({ ok: true, output }, [output.buffer as ArrayBuffer])
  } catch {
    // No detail: an error text must never carry a secret (lib/e2ee/errors.ts).
    scope.postMessage({ ok: false })
  } finally {
    request.password.fill(0)
  }
}
