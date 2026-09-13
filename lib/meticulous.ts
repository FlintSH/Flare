import type { initBackendRecorder } from '@alwaysmeticulous/backend-recorder-launcher'

// Next.js may bundle instrumentation and route handlers separately.
export const meticulousState = globalThis as typeof globalThis & {
  meticulousRecorder?: Awaited<ReturnType<typeof initBackendRecorder>>
}
