import { type AccountUnwrapper, createAccountUnwrapper } from './files'
import type { StoredAccountKeys } from './key-store'
import { retryUnopenedFiles } from './opened-files'

// One set of imported keys per unlocked account record, shared by every
// caller: the library cards, the search index and the background work.
const unwrappers = new WeakMap<StoredAccountKeys, Promise<AccountUnwrapper>>()

/** The imported private keys of an unlocked account, made one time and shared. */
export function unwrapperFor(keys: StoredAccountKeys) {
  let unwrapper = unwrappers.get(keys)
  if (!unwrapper) {
    unwrapper = createAccountUnwrapper(keys)
    unwrappers.set(keys, unwrapper)
    // What earlier keys could not open, these keys may.
    retryUnopenedFiles()
  }
  return unwrapper
}
