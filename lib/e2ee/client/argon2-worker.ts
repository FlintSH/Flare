import { E2eeError } from '../errors'
import type { Argon2id } from '../kdf'
import type { Argon2WorkerRequest, Argon2WorkerResponse } from './argon2.worker'

/**
 * Argon2id in a Web Worker, so that the page stays responsive during the
 * stretch (docs/e2ee-spec.md, section 4.3). Each call starts one worker and
 * terminates it with its answer: the 64 MiB of WebAssembly memory, which
 * held values that come from the passphrase, are released at once.
 *
 * The worker gets its own copy of the password bytes and overwrites it. The
 * caller keeps and erases the original, as `stretchSecretText` does.
 */
export const workerArgon2id: Argon2id = (input) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const failure = () =>
      new E2eeError('invalid_argument', 'Argon2id did not complete')
    let worker: Worker
    try {
      worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      reject(failure())
      return
    }
    worker.onmessage = (event: MessageEvent<Argon2WorkerResponse>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.output)
      else reject(failure())
    }
    worker.onerror = (event) => {
      event.preventDefault()
      worker.terminate()
      reject(failure())
    }
    const password = input.password.slice()
    const request: Argon2WorkerRequest = {
      password,
      salt: input.salt.slice(),
      memoryKib: input.memoryKib,
      passes: input.passes,
      lanes: input.lanes,
      outputLength: input.outputLength,
    }
    worker.postMessage(request, [password.buffer])
  })
