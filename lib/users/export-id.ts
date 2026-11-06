import { HttpError } from '@/lib/http/errors'

/**
 * Browser-safe. A data export is two requests, the ZIP download and its
 * progress stream, and both name the export with the same `id` parameter.
 */
const EXPORT_ID = /^[A-Za-z0-9_-]{16,64}$/

/** `getRandomValues`, unlike `randomUUID`, also works on plain-HTTP origins. */
export function newExportId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

export function exportUrls(id: string) {
  const query = new URLSearchParams({ id })
  return {
    download: `/api/profile/export?${query}`,
    progress: `/api/profile/export/progress?${query}`,
  }
}

/** The export a request names, or null when it names none. */
export function requestedExportId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get('id')
  if (id !== null && !EXPORT_ID.test(id))
    throw new HttpError(400, 'Invalid export id.')
  return id
}
