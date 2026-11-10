'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { usePathname, useRouter } from 'next/navigation'

import { getSession, useSession } from 'next-auth/react'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import type { AccountKeys } from '@/lib/e2ee/account'
import { unlockWithPassphrase } from '@/lib/e2ee/client/api'
import { browserKeyStore } from '@/lib/e2ee/client/browser-store'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { forgetOpenedFiles } from '@/lib/e2ee/client/opened-files'
import {
  type AccountKeyEvent,
  type AccountKeyState,
  INITIAL_ACCOUNT_KEY_STATE,
  type ServerKeyStatus,
  transitionAccountKeys,
} from '@/lib/e2ee/client/state'
import { forgetThumbnails } from '@/lib/e2ee/client/thumbnails'
import { wipe } from '@/lib/e2ee/primitives'

/** Where an account without keys chooses its passphrase. */
export const KEY_SETUP_PATH = '/auth/encryption'

/** Pages that an account without keys cannot use until key setup is done. */
function needsKeys(pathname: string | null) {
  return (
    !!pathname &&
    (pathname.startsWith('/dashboard') ||
      pathname.startsWith('/setup') ||
      pathname === '/auth/verify-email')
  )
}

/** Keys that the client just opened or created, to keep for the session. */
export interface OpenedKeys {
  readonly accountKeys: Pick<
    AccountKeys,
    'accountPrivateKey' | 'accountPublicKey'
  >
  readonly oldPrivateKeys?: readonly Uint8Array[]
}

interface AccountKeysContext {
  /** The one state of the account keys in this browser. */
  readonly state: AccountKeyState
  /** Reads the session and the key status of its account again. */
  refresh(): Promise<AccountKeyState>
  /**
   * Keeps keys for the session's account. The keys of a different account
   * are dropped: the result says which state the browser is in.
   */
  adopt(keys: OpenedKeys): Promise<AccountKeyState>
  /** Section 6.3 of the specification for a locked browser. Rejects when the passphrase is wrong. */
  unlock(passphrase: string): Promise<AccountKeyState>
  /** Erases the keys of this browser. The session continues. */
  lock(): Promise<AccountKeyState>
}

const Context = createContext<AccountKeysContext | null>(null)

/**
 * Holds the account keys of the signed-in user for the life of the session
 * (docs/e2ee-spec.md, section 6.4): in IndexedDB, erased at sign-out, when
 * the session ends, and when the session belongs to a different user or the
 * account record changed.
 */
export function AccountKeysProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { data: session, status } = useSession()
  const userId = session?.user?.id ?? null
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState(INITIAL_ACCOUNT_KEY_STATE)
  const current = useRef(state)
  // Events are applied one after the other, each with its store effect.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const send = useCallback((event: () => Promise<AccountKeyEvent | null>) => {
    const work = queue.current.then(async () => {
      const next = await event()
      if (!next) return current.current
      const { state: after, effect } = transitionAccountKeys(
        current.current,
        next
      )
      if (effect.type === 'clear') await browserKeyStore().clear()
      if (effect.type === 'save') await browserKeyStore().save(effect.keys)
      current.current = after
      setState(after)
      return after
    })
    queue.current = work.catch(() => undefined)
    return work
  }, [])

  const resolve = useCallback(
    (knownUserId?: string | null) =>
      send(async () => {
        const id =
          knownUserId === undefined
            ? ((await getSession())?.user?.id ?? null)
            : knownUserId
        if (!id) return { type: 'session-ended' }
        let server: ServerKeyStatus
        try {
          server = await apiRequest<ServerKeyStatus>('/api/auth/e2ee/keys')
        } catch (error) {
          if (error instanceof RefusedRequest && error.status === 401)
            return { type: 'session-ended' }
          // No answer says nothing about the keys. The state stays.
          return null
        }
        return {
          type: 'session-resolved',
          userId: id,
          server,
          stored: await browserKeyStore()
            .load()
            .catch(() => null),
        }
      }),
    [send]
  )

  useEffect(() => {
    if (status === 'loading') return
    void resolve(status === 'authenticated' ? userId : null)
  }, [status, userId, resolve])

  // The file keys this page opened are useless and unwanted without the
  // account keys: erase them when the browser locks or the session ends.
  useEffect(() => {
    if (state.status === 'locked' || state.status === 'signed-out') {
      forgetOpenedFiles()
      forgetThumbnails()
    }
  }, [state.status])

  const adopt = useCallback(
    async (opened: OpenedKeys) => {
      // The session can be seconds old: read it, do not trust the last render.
      await resolve()
      return send(async () => {
        const id = (await getSession())?.user?.id
        if (!id) return { type: 'session-ended' }
        const keys: StoredAccountKeys = {
          userId: id,
          accountPublicKey: opened.accountKeys.accountPublicKey.slice(),
          accountPrivateKey: opened.accountKeys.accountPrivateKey.slice(),
          oldPrivateKeys: (opened.oldPrivateKeys ?? []).map((key) =>
            key.slice()
          ),
        }
        return { type: 'keys-unlocked', keys }
      })
    },
    [resolve, send]
  )

  const unlock = useCallback(
    async (passphrase: string) => {
      const opened = await unlockWithPassphrase(passphrase)
      try {
        return await adopt(opened)
      } finally {
        wipe(
          opened.rootEntropy,
          opened.accountKeys.accountPrivateKey,
          opened.accountKeys.exchangePrivateKey,
          ...opened.oldPrivateKeys
        )
      }
    },
    [adopt]
  )

  const lock = useCallback(
    () => send(async () => ({ type: 'keys-dropped' })),
    [send]
  )

  // An account without keys must choose its passphrase before anything else.
  const setupRequired = state.status === 'setup-required' && !!state.identifier
  useEffect(() => {
    if (setupRequired && needsKeys(pathname)) router.replace(KEY_SETUP_PATH)
  }, [setupRequired, pathname, router])

  const value = useMemo(
    () => ({ state, refresh: () => resolve(), adopt, unlock, lock }),
    [state, resolve, adopt, unlock, lock]
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/**
 * The account keys of this browser. Later phases read
 * `state.status === 'unlocked'` and `state.keys` to encrypt and decrypt.
 */
export function useAccountKeys(): AccountKeysContext {
  const context = useContext(Context)
  if (!context)
    throw new Error('useAccountKeys must be used inside AccountKeysProvider')
  return context
}

/**
 * The state of the account keys, or `loading` where no provider is mounted.
 * For components that also render outside the application shell and only
 * read the state: a plain file needs no key at all.
 */
export function useAccountKeyState(): AccountKeyState {
  return useContext(Context)?.state ?? INITIAL_ACCOUNT_KEY_STATE
}
