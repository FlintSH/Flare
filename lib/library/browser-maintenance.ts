import { apiRequest } from '@/lib/client/request'
import { replaceKeyring } from '@/lib/e2ee/client/api'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import {
  type MigrationApi,
  type OldStanzas,
  migrateStanzas,
} from '@/lib/e2ee/client/rotation'
import { forgetThumbnail } from '@/lib/e2ee/client/thumbnails'
import { unwrapperFor } from '@/lib/e2ee/client/unwrappers'
import { fetchDecrypted } from '@/lib/files/encrypted-client'
import { normalizedType } from '@/lib/files/safe-render'
import { makeThumbnail } from '@/lib/files/thumbnail-client'
import {
  type FolderRepairs,
  type RepairsApi,
  repairFolders,
} from '@/lib/folders/repairs'
import type { FolderView } from '@/lib/folders/schema'
import { recognizeImage } from '@/lib/ocr/browser'
import { tagsApi } from '@/lib/tags/browser'
import { sealPlainTags } from '@/lib/tags/client'
import { type OwnedTagView, ownedTagViews } from '@/lib/tags/owned'

import { takeLocalFile } from './local-files'
import {
  type JobContext,
  type JobRunner,
  type MaintenanceJob,
  createMaintenance,
} from './maintenance'
import { type PendingFile, processPendingWork } from './pending-work'
import { searchIndex } from './search-client'

/**
 * The background work of this browser tab for the unlocked account: the
 * queue of `maintenance.ts` with the jobs that talk to Flare's API. Client
 * only. Every request here carries sealed records, public keys and IDs,
 * and never a private key, a name or a text in the clear.
 */

type Context = JobContext<StoredAccountKeys>

/** Told after a job changed what the library lists, so open lists load again. */
let libraryChanged: (() => void) | null = null

export function onMaintenanceChange(listener: (() => void) | null) {
  libraryChanged = listener
}

const folderRepairsApi: RepairsApi = {
  folders: () => apiRequest<FolderView[]>('/api/folders'),
  repairs: (after) =>
    apiRequest<FolderRepairs>(
      `/api/folders/repairs${after ? `?after=${encodeURIComponent(after)}` : ''}`
    ),
  putKeys: (body) => apiRequest('/api/folders/keys', { method: 'PUT', body }),
  putFileStanzas: (body) =>
    apiRequest('/api/files/folder-stanzas', { method: 'PUT', body }),
}

async function runFolderRepairs({ keys, signal, report }: Context) {
  report({ label: 'Updating folder keys', done: 0, total: null })
  const result = await repairFolders(
    folderRepairsApi,
    keys,
    await unwrapperFor(keys),
    { signal }
  )
  if (result.folderKeys || result.parentStanzas || result.fileStanzas)
    libraryChanged?.()
}

/** Told the old private keys that stay, after the keyring lost keys with no stanza left. */
let keyringPruned: ((oldPrivateKeys: Uint8Array[]) => void) | null = null

export function onKeyringPruned(
  listener: ((oldPrivateKeys: Uint8Array[]) => void) | null
) {
  keyringPruned = listener
}

async function runStanzaMigration({ keys, signal, report }: Context) {
  // Nothing to do for an account that never rotated its keys.
  if (!keys.oldPrivateKeys.length) return
  const api: MigrationApi = {
    oldStanzas: (after) =>
      apiRequest<OldStanzas>(
        `/api/files/stanzas${after ? `?after=${encodeURIComponent(after)}` : ''}`
      ),
    replace: (body) =>
      apiRequest('/api/files/stanzas', { method: 'PUT', body }),
    replaceKeyring: (sealedKeyring) =>
      replaceKeyring(keys.accountPrivateKey, sealedKeyring),
  }
  report({ label: 'Updating file keys', done: 0, total: null })
  const result = await migrateStanzas(api, keys, await unwrapperFor(keys), {
    signal,
    onProgress: (done, total) =>
      report({ label: 'Updating file keys', done, total }),
  })
  if (result.migrated) libraryChanged?.()
  if (result.pruned) keyringPruned?.(result.oldPrivateKeys)
}

async function runTagConversion({ keys, signal, report }: Context) {
  report({ label: 'Encrypting tag names', done: 0, total: null })
  if (await sealPlainTags(tagsApi, keys, { signal })) libraryChanged?.()
}

/**
 * The local search index (docs/e2ee-spec.md, section 9.8): starts the worker
 * for these keys if it does not run, and asks the server for what changed.
 */
async function runSearchIndex({ keys, report }: Context) {
  searchIndex.start(keys)
  const show = () => {
    const state = searchIndex.getState()
    if (state.status !== 'ready' && state.total > 0)
      report({
        label: 'Preparing search',
        done: state.indexed,
        total: state.total,
      })
  }
  const unsubscribe = searchIndex.subscribe(show)
  try {
    await searchIndex.sync()
  } finally {
    unsubscribe()
  }
}

async function runPendingWork({ keys, signal, report, unpaused }: Context) {
  const unwrapper = await unwrapperFor(keys)
  let tags: Promise<readonly OwnedTagView[] | null> | null = null
  let changed = false
  let textChanged = false
  await processPendingWork({
    pending: (after) =>
      apiRequest<{ total: number; files: PendingFile[] }>(
        `/api/files/pending${after ? `?after=${encodeURIComponent(after)}` : ''}`
      ),
    work: (id, body) =>
      apiRequest(`/api/files/${encodeURIComponent(id)}/work`, { body }),
    unwrap: (records) => unwrapper.unwrap(records),
    // Rules run only when this browser read every tag of the account.
    tags: () =>
      (tags ??= tagsApi.tags().then((views) => {
        const owned = ownedTagViews(views, keys)
        return owned.some((tag) => tag.locked) ? null : owned
      })),
    plaintext: async (file, opened, maxBytes, abort) => {
      // A file this page uploaded a moment ago is still in memory.
      const local = takeLocalFile(file.id)
      if (local && local.size <= maxBytes) return local
      const content = await fetchDecrypted(file, opened, {
        signal: abort,
        maxBytes,
      })
      return new Blob(content.parts, { type: normalizedType(opened.type) })
    },
    thumbnail: makeThumbnail,
    recognize: (image, abort) => recognizeImage(image, { signal: abort }),
    signal,
    unpaused,
    report: (done, total) =>
      report({ label: 'Finishing new files', done, total }),
    changed: (file, body) => {
      changed = true
      if (body.sealedThumbnail) forgetThumbnail(file.id)
      if (body.sealedOcrText) textChanged = true
    },
    failed: (file, error) =>
      // The ID is public. The reason is what a person needs to report.
      console.warn(
        `Flare could not finish the background work on file ${file.id}:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error
      ),
  })
  if (changed) libraryChanged?.()
  // New text belongs in the local search cache.
  if (textChanged) requestMaintenance('index')
}

const runners: Partial<Record<MaintenanceJob, JobRunner<StoredAccountKeys>>> = {
  tags: runTagConversion,
  folders: runFolderRepairs,
  migration: runStanzaMigration,
  index: runSearchIndex,
  pending: runPendingWork,
}

/** Adds the runner of a job. Each feature registers its own. */
export function registerMaintenanceJob(
  job: MaintenanceJob,
  runner: JobRunner<StoredAccountKeys>
) {
  runners[job] = runner
}

export const libraryMaintenance = createMaintenance<StoredAccountKeys>(runners)

/** Asks the background queue for jobs. Nothing happens while the keys are locked. */
export function requestMaintenance(...jobs: MaintenanceJob[]) {
  libraryMaintenance.request(...jobs)
}

export function notifyLibraryChanged() {
  libraryChanged?.()
}
