import {
  ARCHIVE_BROWSE_LIMITS,
  ARCHIVE_LIMITS,
  type ArchiveEntry,
  type ArchiveListing,
  type ArchiveListingProgress,
  type ArchiveOutputFormat,
} from '@/lib/archives/shared'
import { readAnswer, refusal, sendRequest } from '@/lib/client/request'
import type { EncryptedRecordsWire } from '@/lib/e2ee/client/files'
import { decryptionProblem } from '@/lib/files/encrypted-client'
import { fileKind } from '@/lib/files/file-kind'

import type { EncryptedArchiveHandle } from './encrypted-archive-handle'

/** What an archive request that gives no reason fails with. */
export const ARCHIVE_REQUEST_FAILED =
  'The archive request could not be completed. Please try again.'

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

export const TEXT_PREVIEW_BYTES = ARCHIVE_BROWSE_LIMITS.textPreviewBytes
export const IMAGE_PREVIEW_BYTES = ARCHIVE_BROWSE_LIMITS.imagePreviewBytes

// The archive forms scroll between their title and actions, like the other
// long form dialogs (components/shared/form-styles.ts).
export const ARCHIVE_FORM_DIALOG_CLASS =
  'flex max-h-[calc(100dvh-2rem)] flex-col [&>div:first-child]:flex [&>div:first-child]:min-h-0 [&>div:first-child]:flex-col [&>div:first-child]:gap-5 [&>div:first-child]:space-y-0'

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

/** Whether the library offers Browse archive, including for RAR and 7z. */
export function isArchiveCandidate(name: string, mimeType: string) {
  const { kind } = fileKind({ name, mimeType })
  return kind === 'archive' || kind === 'unsupported-archive'
}

export interface ArchiveFileRef {
  id: string
  name: string
  mimeType?: string
  urlPath?: string
  folderId?: string | null
  /** A file the browser encrypted: the archive tools then run in the browser. */
  encrypted?: boolean
  encryption?: EncryptedRecordsWire | null
  /** The stored size in megabytes, as the library lists it. */
  size?: number
}

export type ArchiveSource =
  | { kind: 'owner' }
  | { kind: 'share'; password?: string }
  /**
   * An encrypted archive, read in this browser. The server has only
   * ciphertext, so no request names an entry (docs/e2ee-spec.md, 12.3).
   */
  | { kind: 'encrypted'; archive: EncryptedArchiveHandle; owner: boolean }

export const OWNER_ARCHIVE_SOURCE = {
  kind: 'owner',
} as const satisfies ArchiveSource

/** Shared passwords travel in the body, never in a URL. */
export function archiveListingRequest(
  id: string,
  source: Exclude<ArchiveSource, { kind: 'encrypted' }>,
  options: { progress?: boolean; after?: number } = {}
): {
  url: string
  body?: { password?: string; progress?: true; after?: number }
} {
  const base = `/api/files/${encodeURIComponent(id)}/archive`
  if (source.kind === 'share')
    return {
      url: `${base}/share`,
      body: {
        ...(source.password ? { password: source.password } : {}),
        ...(options.progress ? { progress: true as const } : {}),
        ...(options.after ? { after: options.after } : {}),
      },
    }
  const query = new URLSearchParams()
  if (options.progress) query.set('progress', '1')
  if (options.after) query.set('after', String(options.after))
  return { url: query.size ? `${base}?${query}` : base }
}

/**
 * GET URL for one entry by its position in the listing, so member names stay
 * out of URLs. Shared reads after a password use the unlock cookie the
 * listing request set; the password itself never appears here.
 */
export function archiveEntryHref(
  id: string,
  source: Exclude<ArchiveSource, { kind: 'encrypted' }>,
  position: number,
  options: { inline?: boolean } = {}
) {
  const base = `/api/files/${encodeURIComponent(id)}/archive${source.kind === 'share' ? '/share' : ''}/entry`
  return `${base}?entry=${position}${options.inline ? '&disposition=inline' : ''}`
}

export function archiveEntryName(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path
}

/** A listed entry, or a folder implied by its children (no position). */
export interface ArchiveRow extends ArchiveEntry {
  position?: number
}

export interface ArchiveTree {
  /** Direct children of each folder path ('' is the root), unsorted. */
  children: Map<string, ArchiveRow[]>
  /** Every file and folder, including implied folders, for search. */
  rows: ArchiveRow[]
  folderCount: number
}

/** Include implicit directories without confusing common path prefixes. */
export function buildArchiveTree(entries: ArchiveEntry[]): ArchiveTree {
  const nodes = new Map<string, ArchiveRow>()
  entries.forEach((entry, position) => {
    const path = entry.path.replace(/\/$/, '')
    if (!path) return
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (!nodes.has(`d:${parent}`))
        nodes.set(`d:${parent}`, { path: parent, type: 'directory', size: 0 })
    }
    const key = `${entry.type === 'directory' ? 'd' : 'f'}:${path}`
    // A repeated path refers to its last copy, as on the server.
    nodes.set(key, { ...entry, path, position })
  })
  const children = new Map<string, ArchiveRow[]>()
  let folderCount = 0
  for (const row of nodes.values()) {
    if (row.type === 'directory') folderCount++
    const parent = row.path.includes('/')
      ? row.path.slice(0, row.path.lastIndexOf('/'))
      : ''
    let list = children.get(parent)
    if (!list) children.set(parent, (list = []))
    list.push(row)
  }
  return { children, rows: [...nodes.values()], folderCount }
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

function compareRows(left: ArchiveRow, right: ArchiveRow) {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return collator.compare(left.path, right.path)
}

export function archiveFolderRows(tree: ArchiveTree, directory: string) {
  return [...(tree.children.get(directory) ?? [])].sort(compareRows)
}

export function searchArchiveRows(tree: ArchiveTree, search: string) {
  const query = search.trim().toLowerCase()
  return tree.rows
    .filter((row) => row.path.toLowerCase().includes(query))
    .sort(compareRows)
}

/** Rows shown for a folder, or for a search across the whole archive. */
export function archiveEntriesAt(
  entries: ArchiveEntry[],
  directory: string,
  search: string
): ArchiveEntry[] {
  const tree = buildArchiveTree(entries)
  return (
    search.trim()
      ? searchArchiveRows(tree, search)
      : archiveFolderRows(tree, directory)
  ).map((row) => ({ path: row.path, type: row.type, size: row.size }))
}

export function archiveOutputName(name: string, format: ArchiveOutputFormat) {
  const stem = name.trim().replace(/\.(zip|tar\.gz|tgz)$/i, '')
  return `${stem || 'Archive'}.${format}`
}

export type ArchivePreviewKind = 'image' | 'video' | 'audio' | 'text'

/** A guess from the name; the server checks the bytes before inline display. */
export function archivePreviewKind(
  path: string
): { type: ArchivePreviewKind } | null {
  const name = path.split('/').at(-1)?.toLowerCase() || ''
  const extension = name.includes('.') ? name.split('.').at(-1)! : ''
  if (/^(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(extension))
    return { type: 'image' }
  if (/^(mp4|m4v|mov|webm|mkv|ogv)$/.test(extension)) return { type: 'video' }
  if (/^(mp3|m4a|aac|wav|flac|ogg|oga|opus)$/.test(extension))
    return { type: 'audio' }
  // Active formats are displayed as text, never embedded as documents.
  if (
    /^(txt|text|md|markdown|rst|adoc|csv|tsv|json|jsonl|ndjson|yaml|yml|toml|xml|svg|html?|xhtml|css|scss|sass|less|js|jsx|ts|tsx|mjs|cjs|py|go|rs|sh|bash|zsh|fish|ps1|bat|cmd|log|ini|conf|cfg|properties|env|c|cc|cpp|cxx|h|hpp|cs|java|kt|kts|swift|scala|gradle|rb|php|pl|lua|r|dart|sql|vue|svelte|tex|srt|vtt|diff|patch|lock|gitignore|gitattributes|editorconfig|dockerignore|npmrc)$/.test(
      extension
    ) ||
    /^(readme|license|licence|copying|notice|authors|contributors|changelog|changes|todo|dockerfile|makefile|procfile|gemfile|rakefile|vagrantfile|caddyfile|justfile)$/.test(
      name
    )
  )
    return { type: 'text' }
  return null
}

export function archiveErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return ARCHIVE_REQUEST_FAILED
  // Failures of an encrypted archive that is read in this browser.
  if (error.name === 'E2eeError' || error.name === 'CiphertextRefused')
    return decryptionProblem(error)
  if (error.name === 'SourceError') {
    const { failure } = error as Error & { failure?: string }
    return failure === 'refused'
      ? 'The server did not send this file. It may have been deleted or made private.'
      : failure === 'changed'
        ? 'This file did not pass its integrity check. It was changed or cut after it was encrypted, so Flare will not show or save it.'
        : 'The file could not be loaded. Check your connection and try again.'
  }
  return error.message || ARCHIVE_REQUEST_FAILED
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export type ArchiveLoadUpdate =
  | { status: 'busy' }
  | {
      status: 'indexing'
      entries: ArchiveEntry[]
      progress: ArchiveListingProgress
    }

/**
 * Load a listing, polling while the server reads a slow archive. Entries found
 * so far arrive through `onUpdate`, so browsing can start before the end.
 */
export async function loadArchiveListing(
  id: string,
  source: Exclude<ArchiveSource, { kind: 'encrypted' }>,
  options: {
    signal: AbortSignal
    onUpdate: (update: ArchiveLoadUpdate) => void
  }
): Promise<ArchiveListing> {
  let entries: ArchiveEntry[] = []
  let busyRetries = 0
  while (true) {
    const request = archiveListingRequest(id, source, {
      progress: true,
      after: entries.length,
    })
    const response = await sendRequest(request.url, {
      body: request.body,
      signal: options.signal,
    })
    if (!response.ok) {
      const refused = await refusal(response, ARCHIVE_REQUEST_FAILED)
      if (refused.status !== 429 || busyRetries >= 6) throw refused
      busyRetries++
      options.onUpdate({ status: 'busy' })
      await sleep(Math.min(refused.retryAfter || 5, 60) * 1000, options.signal)
      continue
    }
    const answer = await readAnswer<ArchiveListing | ArchiveListingProgress>(
      response,
      { signal: options.signal, fallback: ARCHIVE_REQUEST_FAILED }
    )
    entries = entries.concat(answer.entries)
    if (response.status !== 202)
      return { ...(answer as ArchiveListing), entries }
    options.onUpdate({
      status: 'indexing',
      entries,
      progress: answer as ArchiveListingProgress,
    })
    await sleep(1000, options.signal)
  }
}
