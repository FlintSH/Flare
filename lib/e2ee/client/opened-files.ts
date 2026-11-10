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

function changed() {
  version++
  for (const watch of watchers) watch()
}

export function openedFile(id: string): OpenedFile | undefined {
  return opened.get(id)
}

export function rememberOpenedFile(id: string, file: OpenedFile) {
  opened.set(id, {
    ...file,
    fileKey: file.fileKey.slice() as typeof file.fileKey,
  })
  unopened.delete(id)
  changed()
}

/** Records that the keys this browser holds do not open the file. */
export function rememberUnopenedFile(id: string) {
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
