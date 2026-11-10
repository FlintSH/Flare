import { type KeyStore, createBrowserKeyStore } from './key-store'
import { dropLocalAddresses } from './local-address'

let store: KeyStore | null = null

/** The one key store of this page. Every tab of the origin reads the same IndexedDB record. */
export function browserKeyStore(): KeyStore {
  store ??= createBrowserKeyStore()
  return store
}

/**
 * Erases the account keys of this browser (docs/e2ee-spec.md, section 6.4).
 * For code that ends the session, before the provider sees the change. It
 * never rejects: a sign-out must go on.
 */
export function clearStoredAccountKeys(): Promise<void> {
  // The service worker holds file keys in memory. They go too (section 12.2).
  dropLocalAddresses()
  return browserKeyStore()
    .clear()
    .catch(() => undefined)
}
