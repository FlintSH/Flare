/**
 * Where the browser keeps the account private keys during a session
 * (docs/e2ee-spec.md, section 6.4).
 *
 * The store holds `account_private_key` and the old private keys of the
 * keyring, with the id of the user that they belong to. It must never hold
 * the passphrase, `passphrase_root`, `wrap_key` or `root_entropy`: the type
 * below has no field for them.
 */
export interface StoredAccountKeys {
  readonly userId: string
  readonly accountPublicKey: Uint8Array
  readonly accountPrivateKey: Uint8Array
  /** Newest first (section 4.4, rule 11). Empty for an account with no old key. */
  readonly oldPrivateKeys: readonly Uint8Array[]
}

export interface KeyStore {
  load(): Promise<StoredAccountKeys | null>
  save(keys: StoredAccountKeys): Promise<void>
  clear(): Promise<void>
}

function isBytes(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.length === length
}

/** A record that is not exactly a `StoredAccountKeys` is treated as no record. */
export function readStoredAccountKeys(
  value: unknown
): StoredAccountKeys | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.userId !== 'string' ||
    !record.userId ||
    !isBytes(record.accountPublicKey, 32) ||
    !isBytes(record.accountPrivateKey, 32) ||
    !Array.isArray(record.oldPrivateKeys) ||
    !record.oldPrivateKeys.every((key) => isBytes(key, 32))
  )
    return null
  return {
    userId: record.userId,
    accountPublicKey: record.accountPublicKey,
    accountPrivateKey: record.accountPrivateKey,
    oldPrivateKeys: record.oldPrivateKeys as Uint8Array[],
  }
}

function copy(keys: StoredAccountKeys): StoredAccountKeys {
  return {
    userId: keys.userId,
    accountPublicKey: keys.accountPublicKey.slice(),
    accountPrivateKey: keys.accountPrivateKey.slice(),
    oldPrivateKeys: keys.oldPrivateKeys.map((key) => key.slice()),
  }
}

/** A store in memory, for tests and for a browser without IndexedDB. Keys do not survive a reload. */
export function createMemoryKeyStore(): KeyStore {
  let held: StoredAccountKeys | null = null
  const erase = () => {
    if (!held) return
    held.accountPrivateKey.fill(0)
    held.oldPrivateKeys.forEach((key) => key.fill(0))
    held = null
  }
  return {
    async load() {
      return held && copy(held)
    },
    async save(keys) {
      const next = copy(keys)
      erase()
      held = next
    },
    async clear() {
      erase()
    },
  }
}

const DATABASE = 'flare-e2ee'
const OBJECT_STORE = 'account-keys'
const RECORD = 'current'

function request<Result>(source: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(source.error)
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(DATABASE, 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(OBJECT_STORE)
    }
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
}

/**
 * The store in IndexedDB: one database, one object store, one record. The
 * byte arrays are stored as they are, by structured clone. Every tab of the
 * origin reads the same record.
 */
export function createIndexedDbKeyStore(factory: IDBFactory): KeyStore {
  async function run<Result>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<Result>
  ): Promise<Result> {
    const database = await openDatabase(factory)
    try {
      const transaction = database.transaction(OBJECT_STORE, mode)
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      const result = await request(work(transaction.objectStore(OBJECT_STORE)))
      await done
      return result
    } finally {
      database.close()
    }
  }
  return {
    async load() {
      return readStoredAccountKeys(
        await run('readonly', (store) => store.get(RECORD))
      )
    },
    async save(keys) {
      await run('readwrite', (store) => store.put(copy(keys), RECORD))
    },
    async clear() {
      await run('readwrite', (store) => store.delete(RECORD))
    },
  }
}

/** The store of this browser: IndexedDB, or memory where IndexedDB is not available. */
export function createBrowserKeyStore(): KeyStore {
  const memory = createMemoryKeyStore()
  const factory = typeof indexedDB === 'undefined' ? null : indexedDB
  if (!factory) return memory
  const persistent = createIndexedDbKeyStore(factory)
  // Private windows of some browsers refuse IndexedDB at the first use. The
  // keys then stay in memory until the page is closed.
  let usable = true
  async function attempt<Result>(
    primary: () => Promise<Result>,
    fallback: () => Promise<Result>
  ) {
    if (usable) {
      try {
        return await primary()
      } catch {
        usable = false
      }
    }
    return fallback()
  }
  return {
    load: () => attempt(persistent.load, memory.load),
    save: (keys) =>
      attempt(
        () => persistent.save(keys),
        () => memory.save(keys)
      ),
    async clear() {
      await memory.clear()
      if (usable) await persistent.clear().catch(() => undefined)
    },
  }
}
