import {
  ARCHIVE_LIMITS,
  type ArchiveEntry,
  type ArchiveOutputFormat,
  detectArchiveFormat,
} from '@/lib/archives/shared'

/** File-library metadata uses MiB; archive contracts use bytes. */
export function archiveSelectionSize(files: { size: number }[]) {
  const totalBytes = files.reduce((sum, file) => sum + file.size * 1024 ** 2, 0)
  return {
    totalBytes,
    overLimit:
      files.length > ARCHIVE_LIMITS.selectedFiles ||
      totalBytes > ARCHIVE_LIMITS.expandedBytes ||
      files.some((file) => file.size * 1024 ** 2 > ARCHIVE_LIMITS.fileBytes),
  }
}

export const TEXT_PREVIEW_BYTES = 256 * 1024
export const IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024

export const ARCHIVE_FORM_DIALOG_CLASS =
  'max-h-[calc(100dvh-2rem)] overflow-hidden [&>div:first-child]:flex [&>div:first-child]:max-h-[calc(100dvh-7rem)] [&>div:first-child]:min-h-0 [&>div:first-child]:flex-col [&>div:first-child]:gap-5 [&>div:first-child]:space-y-0'

export type ArchiveProfileSnapshot = {
  id: string
  revision: string
  effectiveRevision: string
}

export function archiveProfileRequest(
  profileId: string | null,
  snapshot: ArchiveProfileSnapshot | null
) {
  if (!profileId) return { profileId: null }
  if (
    !snapshot ||
    snapshot.id !== profileId ||
    !snapshot.revision ||
    !snapshot.effectiveRevision
  )
    throw new Error(
      'Wait for the selected upload profile to load, or choose private output.'
    )
  return {
    profileId,
    profileRevision: snapshot.revision,
    profileEffectiveRevision: snapshot.effectiveRevision,
  }
}

export function archiveFolderCount(entries: ArchiveEntry[]) {
  const folders = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.replace(/\/$/, '').split('/')
    const count = entry.type === 'directory' ? parts.length : parts.length - 1
    for (let index = 1; index <= count; index++)
      folders.add(parts.slice(0, index).join('/'))
  }
  return folders.size
}

export class ArchiveRequestError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

export function isArchiveCandidate(name: string, mimeType: string) {
  return (
    !!detectArchiveFormat(name, mimeType) ||
    /\.(rar|7z)$/i.test(name) ||
    /(?:rar|7z-compressed)/i.test(mimeType)
  )
}

export function isSafeArchiveImage(mimeType: string) {
  return /^(image\/(png|jpeg|gif|webp|avif|bmp))$/.test(
    mimeType.split(';')[0].trim().toLowerCase()
  )
}

export interface ArchiveFileRef {
  id: string
  name: string
  urlPath?: string
  folderId?: string | null
}

export type ArchiveSource =
  { kind: 'owner' } | { kind: 'share'; password?: string }

export const OWNER_ARCHIVE_SOURCE: ArchiveSource = { kind: 'owner' }

/** Shared passwords and entry paths travel in the body, never in a URL. */
export function archiveReadRequest(
  id: string,
  source: ArchiveSource,
  path?: string
): { url: string; body?: { password?: string; path?: string } } {
  const base = `/api/files/${encodeURIComponent(id)}/archive`
  if (source.kind === 'share')
    return {
      url: `${base}/share${path === undefined ? '' : '/entry'}`,
      body: {
        ...(source.password ? { password: source.password } : {}),
        ...(path === undefined ? {} : { path }),
      },
    }
  return {
    url: path === undefined ? base : archiveEntryUrl(id, path),
  }
}

export function archiveEntryName(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path
}

/** Include implicit ZIP directories without confusing common path prefixes. */
export function archiveEntriesAt(
  entries: ArchiveEntry[],
  directory: string,
  search: string
): ArchiveEntry[] {
  const all = new Map<string, ArchiveEntry>()
  for (const entry of entries) {
    const path = entry.path.replace(/\/$/, '')
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (!all.has(parent))
        all.set(parent, { path: parent, type: 'directory', size: 0 })
    }
    all.set(path, { ...entry, path })
  }
  const query = search.trim().toLowerCase()
  const prefix = directory ? `${directory}/` : ''
  return [...all.values()]
    .filter((entry) => {
      if (query) return entry.path.toLowerCase().includes(query)
      if (!entry.path.startsWith(prefix)) return false
      const relative = entry.path.slice(prefix.length)
      return relative.length > 0 && !relative.includes('/')
    })
    .sort((a, b) =>
      a.type !== b.type
        ? a.type === 'directory'
          ? -1
          : 1
        : a.path.localeCompare(b.path)
    )
}

export function archiveOutputName(name: string, format: ArchiveOutputFormat) {
  const stem = name.trim().replace(/\.(zip|tar\.gz|tgz)$/i, '')
  return `${stem || 'Archive'}.${format}`
}

export function archivePreviewKind(
  path: string
): { type: 'image'; mimeType: string } | { type: 'text' } | null {
  const extension = path.split('.').at(-1)?.toLowerCase() || ''
  const imageTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
  }
  if (imageTypes[extension])
    return { type: 'image', mimeType: imageTypes[extension] }
  // Active formats are displayed as text, never embedded as documents.
  if (
    /^(txt|md|markdown|csv|json|jsonl|yaml|yml|toml|xml|svg|html|htm|css|js|jsx|ts|tsx|mjs|cjs|py|go|rs|sh|bash|zsh|log|ini|conf|cfg|c|cpp|h|hpp|java|sql|rb|php|vue|svelte)$/.test(
      extension
    ) ||
    /(^|\/)(readme|license|dockerfile|makefile)$/i.test(path)
  )
    return { type: 'text' }
  return null
}

/** Bound memory even when a response omits or misreports Content-Length. */
export async function readPreviewBytes(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('This entry has no content to preview.')
  const chunks: Uint8Array[] = []
  let length = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = limit - length
      chunks.push(value.slice(0, Math.max(0, remaining)))
      length += Math.min(value.length, remaining)
      if (value.length > remaining) {
        truncated = true
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes, truncated }
}

export function archiveEntryUrl(id: string, path: string) {
  return `/api/files/${encodeURIComponent(id)}/archive/entry?path=${encodeURIComponent(path)}`
}

export async function archiveRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await archiveFetch(url, body, signal)
  const result = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new ArchiveRequestError(
      result.error ||
        'The archive request could not be completed. Please try again.',
      response.status
    )
  return result.data as T
}

export function archiveFetch(
  url: string,
  body?: unknown,
  signal?: AbortSignal
) {
  return fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

export function archiveErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The archive request could not be completed. Please try again.'
}
