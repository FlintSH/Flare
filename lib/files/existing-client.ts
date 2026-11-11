import type { FileType } from '@/types/components/file'

import { apiRequest } from '@/lib/client/request'

import type {
  ExistingFilesChoice,
  ExistingFilesStatus,
  FileEncryptionErrorCode,
} from './existing-encryption'

/**
 * The browser side of the encryption of existing files (docs/e2ee-spec.md,
 * section 14.2). The server does the work: these requests carry a choice or
 * file IDs, and never a key, a name or a file.
 */

export type { ExistingFilesChoice, ExistingFilesStatus }

export const EXISTING_FILES_QUERY = ['existing-files'] as const

export const fetchExistingFiles = () =>
  apiRequest<ExistingFilesStatus>('/api/files/existing')

export const chooseExistingFiles = (choice: ExistingFilesChoice) =>
  apiRequest<ExistingFilesStatus>('/api/files/existing', {
    method: 'PUT',
    body: { choice },
  })

/** The most file IDs in one request (`ENCRYPT_FILES_LIMIT` on the server). */
const BATCH = 500

export async function encryptFiles(fileIds: string[]) {
  let queued = 0
  for (let at = 0; at < fileIds.length; at += BATCH)
    queued += (
      await apiRequest<{ queued: number }>('/api/files/existing/encrypt', {
        body: { fileIds: fileIds.slice(at, at + BATCH) },
      })
    ).queued
  return queued
}

/** How many files the server works on or still has to start. */
export function activeJobs(status: ExistingFilesStatus | undefined) {
  return status ? status.jobs.waiting + status.jobs.running : 0
}

/** Whether Flare asks the one-time question (section 14.2, "When"). */
export function shouldAsk(status: ExistingFilesStatus | undefined) {
  return Boolean(
    status && status.hasKeys && status.choice === null && status.plain.total > 0
  )
}

/** What each answer encrypts, from the counts of plain files. */
export function choiceCounts(plain: ExistingFilesStatus['plain']) {
  return { none: 0, private: plain.private, all: plain.total }
}

export const FAILURE_TEXT: Record<FileEncryptionErrorCode, string> = {
  account_keys_missing: 'Your account has no encryption keys yet.',
  library_not_ready: 'Waiting for your folders and tags to be converted.',
  source_missing: 'The stored file is missing. Ask your administrator.',
  storage_read_failed: 'Storage did not answer. The file is unchanged.',
  storage_write_failed: 'Storage did not answer. The file is unchanged.',
  verification_failed:
    'The encrypted copy did not verify, so the original was kept.',
  interrupted: 'The server was interrupted. The file is unchanged.',
  internal_error: 'Something went wrong. The file is unchanged.',
}

/** What encrypting these plain files changes for links and passwords. */
export function encryptionConsequences(
  files: readonly Pick<FileType, 'visibility' | 'hasPassword'>[]
) {
  const password = files.filter((file) => file.hasPassword).length
  const shared = files.filter(
    (file) => !file.hasPassword && file.visibility === 'PUBLIC'
  ).length
  return { password, shared, quiet: files.length - password - shared }
}

// --- One place that opens the dialogs, for the library and the profile ---

export type ExistingFilesRequest =
  { kind: 'choice' } | { kind: 'files'; files: FileType[] } | null

let request: ExistingFilesRequest = null
const listeners = new Set<() => void>()

export const existingFilesRequests = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get: () => request,
  set(next: ExistingFilesRequest) {
    request = next
    listeners.forEach((listener) => listener())
  },
}

/** Opens the question about every existing file. */
export const openExistingFilesChoice = () =>
  existingFilesRequests.set({ kind: 'choice' })

/** Asks to encrypt the plain files among `files`. Nothing opens when none is plain. */
export function requestFileEncryption(files: FileType[]) {
  const plain = files.filter((file) => !file.encrypted)
  if (plain.length) existingFilesRequests.set({ kind: 'files', files: plain })
  return plain.length
}
