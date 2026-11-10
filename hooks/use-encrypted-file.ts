'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import type { EncryptedRecordsWire, OpenedFile } from '@/lib/e2ee/client/files'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import {
  openedFileState,
  openedFiles,
  rememberOpenedFile,
  rememberUnopenedFile,
} from '@/lib/e2ee/client/opened-files'
import { unwrapperFor } from '@/lib/e2ee/client/unwrappers'

export type EncryptedFileState =
  /** The keys of this browser are locked. The passphrase unlocks them. */
  | { status: 'locked' }
  | { status: 'opening' }
  | { status: 'open'; opened: OpenedFile }
  /** No key of this account opens the file's stanza. */
  | { status: 'failed' }

const pending = new Map<string, Promise<void>>()

/** Opens the account stanza of a file once, for every caller that asks. */
export function openOwnedFile(
  id: string,
  records: EncryptedRecordsWire,
  keys: StoredAccountKeys
): Promise<void> {
  const known = pending.get(id)
  if (known) return known
  const work = unwrapperFor(keys)
    .then((unwrapper) => unwrapper.unwrap(records))
    .then(
      (opened) => rememberOpenedFile(id, opened),
      () => rememberUnopenedFile(id)
    )
    .finally(() => pending.delete(id))
  pending.set(id, work)
  return work
}

/**
 * The owner's view of one encrypted file: its name, type and key once the
 * account key opened its stanza (docs/e2ee-spec.md, section 8.1). Null for a
 * plain file.
 */
export function useEncryptedFile(file: {
  id: string
  encrypted?: boolean
  encryption?: EncryptedRecordsWire | null
}): EncryptedFileState | null {
  const state = useAccountKeyState()
  // The store's version is read into the render, so a change of the store
  // gives this component a new value to render from.
  const snapshot = useSyncExternalStore(
    openedFiles.subscribe,
    openedFiles.version,
    openedFiles.version
  )
  const keys = state.status === 'unlocked' ? state.keys : null
  const encrypted = Boolean(file.encrypted)
  const records = encrypted ? (file.encryption ?? null) : null
  const { opened, failed } = openedFileState(file.id, snapshot)
  const known = Boolean(opened) || failed

  useEffect(() => {
    if (!records || !keys || known) return
    void openOwnedFile(file.id, records, keys)
  }, [file.id, records, keys, known])

  if (!encrypted) return null
  if (opened) return { status: 'open', opened }
  if (!keys) return { status: state.status === 'locked' ? 'locked' : 'opening' }
  if (!records || failed) return { status: 'failed' }
  return { status: 'opening' }
}
