import { apiRequest } from '@/lib/client/request'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { unwrapperFor } from '@/lib/e2ee/client/unwrappers'
import {
  type FolderRepairs,
  type RepairsApi,
  repairFolders,
} from '@/lib/folders/repairs'
import type { FolderView } from '@/lib/folders/schema'

import {
  type JobContext,
  type JobRunner,
  type MaintenanceJob,
  createMaintenance,
} from './maintenance'

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

const runners: Partial<Record<MaintenanceJob, JobRunner<StoredAccountKeys>>> = {
  folders: runFolderRepairs,
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
