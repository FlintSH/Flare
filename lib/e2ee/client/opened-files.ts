import { wipe } from '../primitives'
import type { OpenedFile } from './files'

/**
 * The files this page has opened, by file ID, in memory only
 * (docs/e2ee-spec.md, section 9.8.2). Nothing here is written to storage. A
 * reload, a lock or a sign-out empties it, and the keys are overwritten.
 */
const opened = new Map<string, OpenedFile>()
/** Files whose stanza no key of the account opened. */
const unopened = new Set<string>()
const watchers = new Set<() => void>()
let version = 0
/**
 * Moves on each time the store is emptied. Work that opens a file takes the
 * number when it starts, and its result counts only while the number is
 * still the same: a file key that arrives after a lock or a sign-out must
 * not come back into memory.
 */
let epoch = 0

/** The number that a result must still have to be kept. */
export function openedFilesEpoch(): number {
  return epoch
}

function changed() {
  version++
  for (const watch of watchers) watch()
}

export function openedFile(id: string): OpenedFile | undefined {
  return opened.get(id)
}

/**
 * Keeps an opened file. `startedAt` is `openedFilesEpoch()` from before the
 * work began. If the store was emptied since then, the key is erased and
 * nothing is kept. Returns whether the file was kept.
 */
export function rememberOpenedFile(
  id: string,
  file: OpenedFile,
  startedAt: number
): boolean {
  if (startedAt !== epoch) {
    wipe(file.fileKey)
    return false
  }
  opened.set(id, {
    ...file,
    fileKey: file.fileKey.slice() as typeof file.fileKey,
  })
  unopened.delete(id)
  changed()
  return true
}

/**
 * Records that the keys this browser holds do not open the file. A failure
 * from before the store was emptied says nothing about the keys of now.
 */
export function rememberUnopenedFile(id: string, startedAt: number) {
  if (startedAt !== epoch) return
  unopened.add(id)
  changed()
}

/** Lets files that failed with earlier keys be tried again. */
export function retryUnopenedFiles() {
  if (!unopened.size) return
  unopened.clear()
  changed()
}

/**
 * What the page knows about one file at `snapshot`, the value of
 * `openedFiles.version`. The snapshot is an argument so that a component
 * reads this again when the store changes.
 */
export function openedFileState(
  id: string,
  snapshot: number
): { opened?: OpenedFile; failed: boolean } {
  void snapshot
  return { opened: opened.get(id), failed: unopened.has(id) }
}

/** Erases every key this page holds for a file. */
export function forgetOpenedFiles() {
  // Also with nothing in the store: work that opens a file can be on its way.
  epoch++
  if (!opened.size && !unopened.size) return
  for (const file of opened.values()) wipe(file.fileKey)
  opened.clear()
  unopened.clear()
  changed()
}

export const openedFiles = {
  subscribe(watch: () => void) {
    watchers.add(watch)
    return () => {
      watchers.delete(watch)
    }
  },
  version: () => version,
}
