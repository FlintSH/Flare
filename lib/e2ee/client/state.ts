import { base64urlEncode } from '../primitives'
import type { StoredAccountKeys } from './key-store'

/**
 * The one state of the account keys in this browser. Each page reads it
 * through `useAccountKeys`.
 *
 * - `loading`: the session or the key status is not known yet.
 * - `signed-out`: no session. The key store is empty.
 * - `setup-required`: a session whose account has no keys on the server. The
 *   account must do key setup before anything else (docs/e2ee-spec.md,
 *   section 14.1).
 * - `locked`: a session whose account has keys on the server, and this
 *   browser holds none of them. The passphrase unlocks (section 6.3).
 * - `unlocked`: this browser holds `account_private_key` of the session's
 *   account (section 6.4).
 */
export type AccountKeyState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | {
      readonly status: 'setup-required'
      readonly userId: string
      /** Null for an account with no sign-in address, which cannot set up keys yet. */
      readonly identifier: string | null
    }
  | {
      readonly status: 'locked'
      readonly userId: string
      readonly identifier: string
      /** base64url, as the server reports it. */
      readonly accountPublicKey: string
    }
  | {
      readonly status: 'unlocked'
      readonly userId: string
      readonly identifier: string
      readonly accountPublicKey: string
      readonly keys: StoredAccountKeys
    }

export type AccountKeyStatus = AccountKeyState['status']

/** What `GET /api/auth/e2ee/keys` says about the session's account. */
export interface ServerKeyStatus {
  readonly hasKeys: boolean
  readonly identifier: string | null
  readonly accountPublicKey: string | null
}

export type AccountKeyEvent =
  /** No session: signed out, expired, or a key request answered 401. */
  | { readonly type: 'session-ended' }
  /** The session's account and its key status are known, with what the store holds. */
  | {
      readonly type: 'session-resolved'
      readonly userId: string
      readonly server: ServerKeyStatus
      readonly stored: StoredAccountKeys | null
    }
  /** The client opened `wrapped_root`, or made a new account record, for this user. */
  | { readonly type: 'keys-unlocked'; readonly keys: StoredAccountKeys }
  /** The keys of the account changed on the server, or the user locked this browser. */
  | { readonly type: 'keys-dropped' }

/** What the caller does to the key store after a transition. */
export type KeyStoreEffect =
  | { readonly type: 'none' }
  | { readonly type: 'clear' }
  | { readonly type: 'save'; readonly keys: StoredAccountKeys }

export interface AccountKeyTransition {
  readonly state: AccountKeyState
  readonly effect: KeyStoreEffect
}

export const INITIAL_ACCOUNT_KEY_STATE: AccountKeyState = { status: 'loading' }

const NONE: KeyStoreEffect = { type: 'none' }
const CLEAR: KeyStoreEffect = { type: 'clear' }

/** Whether stored keys are the keys of this user and of the account record that the server has now. */
export function storedKeysMatch(
  stored: StoredAccountKeys | null,
  userId: string,
  accountPublicKey: string | null
): stored is StoredAccountKeys {
  return (
    stored !== null &&
    accountPublicKey !== null &&
    stored.userId === userId &&
    base64urlEncode(stored.accountPublicKey) === accountPublicKey
  )
}

/**
 * The state machine. It is a pure function: the provider gives it events and
 * applies the effect to the key store.
 *
 * The store is cleared whenever it could hold keys that are not the keys of
 * the session's account: with no session, for a different user, and after
 * the account record changed on the server.
 */
export function transitionAccountKeys(
  state: AccountKeyState,
  event: AccountKeyEvent
): AccountKeyTransition {
  switch (event.type) {
    case 'session-ended':
      return { state: { status: 'signed-out' }, effect: CLEAR }

    case 'session-resolved': {
      const { userId, server, stored } = event
      if (!server.hasKeys || !server.accountPublicKey || !server.identifier)
        return {
          state: {
            status: 'setup-required',
            userId,
            identifier: server.identifier,
          },
          effect: stored ? CLEAR : NONE,
        }
      const account = {
        userId,
        identifier: server.identifier,
        accountPublicKey: server.accountPublicKey,
      }
      if (storedKeysMatch(stored, userId, server.accountPublicKey))
        return {
          state: { status: 'unlocked', ...account, keys: stored },
          effect: NONE,
        }
      return {
        state: { status: 'locked', ...account },
        effect: stored ? CLEAR : NONE,
      }
    }

    case 'keys-unlocked': {
      // Keys are accepted only for the account record that the session is
      // known to be for. In any other state the caller resolves the session
      // first, and the keys of a different user or record are dropped.
      if (
        (state.status !== 'locked' && state.status !== 'unlocked') ||
        state.userId !== event.keys.userId ||
        state.accountPublicKey !== base64urlEncode(event.keys.accountPublicKey)
      )
        return { state, effect: NONE }
      return {
        state: {
          status: 'unlocked',
          userId: state.userId,
          identifier: state.identifier,
          accountPublicKey: state.accountPublicKey,
          keys: event.keys,
        },
        effect: { type: 'save', keys: event.keys },
      }
    }

    case 'keys-dropped':
      if (state.status !== 'unlocked') return { state, effect: CLEAR }
      return {
        state: {
          status: 'locked',
          userId: state.userId,
          identifier: state.identifier,
          accountPublicKey: state.accountPublicKey,
        },
        effect: CLEAR,
      }
  }
}
