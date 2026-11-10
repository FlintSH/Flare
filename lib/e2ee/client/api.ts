import { signIn } from 'next-auth/react'

import { SignInError } from '@/lib/auth/sign-in'
import { apiRequest, readAnswer } from '@/lib/client/request'

import {
  type AccountKeys,
  type PassphraseKeys,
  derivePassphraseKeys,
  mnemonicFromRootEntropy,
  openKeyring,
  signInSignature,
  unlockSignature,
} from '../account'
import { base64urlEncode, wipe } from '../primitives'
import { workerArgon2id } from './argon2-worker'
import {
  type NewAccount,
  type OpenedAccount,
  accountKeysFromMnemonic,
  createNewAccount,
  createRotation,
  openAccount,
  wipeAccountKeys,
  wipePassphraseKeys,
} from './procedures'
import {
  type RotatedLibraryWire,
  type SealedLibrary,
  resealLibrary,
} from './rotation'
import { buildSignedRequest } from './signed-request'
import {
  accountPublicKeyFromWire,
  accountRecordToWire,
  assertKnownProtocolVersion,
  challengeFromWire,
  passphraseSaltFromWire,
  sealedKeyringFromWire,
  sealedKeyringToWire,
  wrappedRootFromWire,
} from './wire'

// The requests of the browser client to the account key routes
// (docs/site/api/account-keys.md). No request of this file carries a
// passphrase, a mnemonic, `root_entropy`, `wrap_key` or a private key: each
// body is made from public keys, salts, sealed records, challenges and
// signatures only.

/** A challenge lives for 60 seconds. One older than this is replaced before it is signed. */
const CHALLENGE_FRESH_MS = 40_000

// --- Sign-in (sections 6.1 and 6.2) ---

export type SignInChallenge =
  | { readonly method: 'password' }
  | {
      readonly method: 'passphrase'
      readonly passphraseSalt: string
      readonly protocolVersion: number
      readonly challenge: string
    }

/** Section 6.1. Also tells the sign-in page which form the account needs (section 14.1). */
export function requestSignInChallenge(
  identifier: string,
  signal?: AbortSignal
): Promise<SignInChallenge> {
  return apiRequest<SignInChallenge>('/api/auth/e2ee/challenge', {
    body: { identifier },
    signal,
    fallback: 'Unable to start sign-in. Please try again.',
  })
}

/** Steps 2 and 3 of section 6.2, in a worker. The caller erases the result with `wipePassphraseKeys`. */
export function derivePassphraseKeysInWorker(
  passphrase: string,
  passphraseSalt: string
): Promise<PassphraseKeys> {
  return derivePassphraseKeys({
    passphrase,
    passphraseSalt: passphraseSaltFromWire(passphraseSalt),
    argon2id: workerArgon2id,
  })
}

export type PassphraseSignInResult =
  | 'signed-in'
  | 'two-factor-required'
  | 'passkey-required'
  | 'too-many-attempts'
  | 'refused'

/**
 * Steps 4 to 8 of section 6.2 with keys that are in memory: a new challenge,
 * the sign-in signature, and the `passphrase` provider. The second attempt
 * with an authenticator code calls this again. It never runs Argon2id.
 */
export async function signInWithPassphraseKeys(input: {
  readonly identifier: string
  readonly passphraseKeys: Pick<PassphraseKeys, 'authPrivateKey'>
  readonly code?: string
  /** A challenge that was issued a moment ago for this identifier. Without one, a new one is requested. */
  readonly challenge?: string
}): Promise<PassphraseSignInResult> {
  let challenge = input.challenge
  if (!challenge) {
    const answer = await requestSignInChallenge(input.identifier)
    if (answer.method !== 'passphrase') return 'refused'
    challenge = answer.challenge
  }
  const signature = signInSignature({
    authPrivateKey: input.passphraseKeys.authPrivateKey,
    challenge: challengeFromWire(challenge),
    identifier: input.identifier,
  })
  const result = await signIn('passphrase', {
    identifier: input.identifier,
    challenge,
    signature: base64urlEncode(signature),
    ...(input.code ? { code: input.code } : {}),
    redirect: false,
    callbackUrl: '/dashboard',
  })
  if (result?.ok && !result.error) return 'signed-in'
  if (result?.error === SignInError.TwoFactorRequired)
    return 'two-factor-required'
  if (result?.error === SignInError.PasskeyRequired) return 'passkey-required'
  if (result?.error === SignInError.TooManyAttempts) return 'too-many-attempts'
  return 'refused'
}

/**
 * The first attempt of a passphrase sign-in: the salt and a challenge, one
 * Argon2id, then the signature. Returns the keys with the result, so that
 * the caller can answer a second-factor request and unlock without a second
 * Argon2id. The caller erases them.
 */
export async function signInWithPassphrase(input: {
  readonly identifier: string
  readonly passphrase: string
}): Promise<{
  readonly result: PassphraseSignInResult | 'password-account'
  readonly passphraseKeys: PassphraseKeys | null
}> {
  const answer = await requestSignInChallenge(input.identifier)
  if (answer.method !== 'passphrase')
    return { result: 'password-account', passphraseKeys: null }
  assertKnownProtocolVersion(answer.protocolVersion)
  const issued = Date.now()
  const passphraseKeys = await derivePassphraseKeysInWorker(
    input.passphrase,
    answer.passphraseSalt
  )
  try {
    const result = await signInWithPassphraseKeys({
      identifier: input.identifier,
      passphraseKeys,
      challenge:
        Date.now() - issued < CHALLENGE_FRESH_MS ? answer.challenge : undefined,
    })
    return { result, passphraseKeys }
  } catch (error) {
    wipePassphraseKeys(passphraseKeys)
    throw error
  }
}

// --- Session challenges and unlock (section 6.3) ---

export interface SessionChallenge {
  readonly challenge: string
  readonly identifier: string
  readonly passphraseSalt: string
  readonly protocolVersion: number
  readonly accountPublicKey: string
}

export function requestSessionChallenge(): Promise<SessionChallenge> {
  return apiRequest<SessionChallenge>('/api/auth/e2ee/session-challenge', {
    method: 'POST',
    fallback: 'Unable to reach the server. Please try again.',
  })
}

/**
 * Steps 3 to 9 of section 6.3 with keys that are in memory. A wrong
 * passphrase is refused by the server with the code `invalid_proof`. The
 * caller erases `rootEntropy` and the passphrase keys.
 */
export async function unlockWithKeys(
  passphraseKeys: PassphraseKeys,
  known?: SessionChallenge
): Promise<OpenedAccount> {
  const session = known ?? (await requestSessionChallenge())
  assertKnownProtocolVersion(session.protocolVersion)
  const signature = unlockSignature({
    authPrivateKey: passphraseKeys.authPrivateKey,
    challenge: challengeFromWire(session.challenge),
    identifier: session.identifier,
  })
  const released = await apiRequest<{
    accountPublicKey: string
    protocolVersion: number
    wrappedRoot: string
    sealedKeyring: string | null
  }>('/api/auth/e2ee/unlock', {
    body: {
      challenge: session.challenge,
      signature: base64urlEncode(signature),
    },
    fallback: 'Unable to unlock your keys. Please try again.',
  })
  assertKnownProtocolVersion(released.protocolVersion)
  return openAccount({
    passphraseKeys,
    accountPublicKey: accountPublicKeyFromWire(released.accountPublicKey),
    wrappedRoot: wrappedRootFromWire(released.wrappedRoot),
    sealedKeyring: sealedKeyringFromWire(released.sealedKeyring),
  })
}

/** A session challenge with the keys of `passphrase` for its salt, and a challenge that is still fresh. */
async function proveSessionPassphrase(passphrase: string) {
  const first = await requestSessionChallenge()
  assertKnownProtocolVersion(first.protocolVersion)
  const issued = Date.now()
  const passphraseKeys = await derivePassphraseKeysInWorker(
    passphrase,
    first.passphraseSalt
  )
  try {
    const session =
      Date.now() - issued < CHALLENGE_FRESH_MS
        ? first
        : await requestSessionChallenge()
    return { passphraseKeys, session }
  } catch (error) {
    wipePassphraseKeys(passphraseKeys)
    throw error
  }
}

/**
 * Unlock for a session that has no keys in memory: after a passkey or SSO
 * sign-in, and in a browser whose key store is empty. The caller erases
 * `rootEntropy`.
 */
export async function unlockWithPassphrase(
  passphrase: string
): Promise<OpenedAccount> {
  const { passphraseKeys, session } = await proveSessionPassphrase(passphrase)
  try {
    return await unlockWithKeys(passphraseKeys, session)
  } finally {
    wipePassphraseKeys(passphraseKeys)
  }
}

/** Section 6.5: the mnemonic, for a person who typed the passphrase again. Also returns the opened keys. */
export async function revealRecoveryPhrase(passphrase: string): Promise<{
  readonly mnemonic: string
  readonly accountKeys: AccountKeys
  readonly oldPrivateKeys: OpenedAccount['oldPrivateKeys']
}> {
  const opened = await unlockWithPassphrase(passphrase)
  try {
    return {
      mnemonic: mnemonicFromRootEntropy(opened.rootEntropy),
      accountKeys: opened.accountKeys,
      oldPrivateKeys: opened.oldPrivateKeys,
    }
  } finally {
    wipe(opened.rootEntropy)
  }
}

// --- Key setup (sections 5.4 and 14.1) ---

/**
 * Key setup for a signed-in account that has no keys. The server accepts it
 * for five minutes after a sign-in and answers `recent_sign_in_required`
 * after that. The caller stores `accountKeys`, shows `mnemonic` and erases
 * `passphraseKeys`.
 */
export async function setUpAccountKeys(
  passphrase: string
): Promise<NewAccount> {
  const account = await createNewAccount({
    passphrase,
    argon2id: workerArgon2id,
  })
  try {
    await apiRequest('/api/auth/e2ee/keys', {
      body: { account: accountRecordToWire(account.record) },
      fallback: 'Unable to set up encryption. Please try again.',
    })
    return account
  } catch (error) {
    wipePassphraseKeys(account.passphraseKeys)
    wipeAccountKeys(account.accountKeys)
    throw error
  }
}

// --- Rotation and passphrase change (sections 6.7 and 8.3.3) ---

async function sendSigned(input: Parameters<typeof buildSignedRequest>[0]) {
  const signed = buildSignedRequest(input)
  return readAnswer<Record<string, unknown>>(
    await fetch(signed.path, {
      method: signed.method,
      cache: 'no-store',
      headers: signed.headers,
      body: signed.body,
    }),
    { fallback: 'Unable to complete this request. Please try again.' }
  )
}

/**
 * The sealed folder keys and tag records of the session's account, as the
 * library lists them. A rotation seals each of them again.
 */
async function readSealedLibrary(): Promise<SealedLibrary> {
  const [folders, tags] = await Promise.all([
    apiRequest<
      {
        id: string
        keys?: {
          folderPublicKey: string
          sealedFolderMetadata: string
          sealedFolderPrivateKey: string
        } | null
      }[]
    >('/api/folders', {
      fallback: 'Unable to read your folders. Please try again.',
    }),
    apiRequest<{ id: string; sealed?: string | null }[]>('/api/tags', {
      fallback: 'Unable to read your tags. Please try again.',
    }),
  ])
  return {
    folders: folders.flatMap((folder) =>
      folder.keys ? [{ id: folder.id, ...folder.keys }] : []
    ),
    tags: tags.flatMap((tag) =>
      tag.sealed ? [{ id: tag.id, sealed: tag.sealed }] : []
    ),
  }
}

/**
 * Step 5 of section 8.3.4: stores a keyring without the old keys that have
 * no stanza left, in a request signed with the current account key. `null`
 * stores no keyring.
 */
export async function replaceKeyring(
  accountPrivateKey: Uint8Array,
  sealedKeyring: Uint8Array | null
): Promise<void> {
  const { challenge } = await requestSessionChallenge()
  await sendSigned({
    accountPrivateKey: accountPrivateKey as Parameters<
      typeof buildSignedRequest
    >[0]['accountPrivateKey'],
    challenge,
    method: 'PUT',
    path: '/api/auth/e2ee/keyring',
    body: { sealedKeyring: sealedKeyringToWire(sealedKeyring) },
  })
}

/**
 * A passphrase change, which is a key rotation. The current passphrase is
 * proven two times with one Argon2id: by the unlock that gives the old
 * account key, and by the sign-in signature of the request. The server ends
 * every session and deletes every API token. Returns the new mnemonic.
 */
export async function changePassphrase(input: {
  readonly currentPassphrase: string
  readonly newPassphrase: string
}): Promise<{ readonly mnemonic: string }> {
  const { passphraseKeys: oldPassphraseKeys, session } =
    await proveSessionPassphrase(input.currentPassphrase)
  let opened: OpenedAccount | null = null
  let rotation: Awaited<ReturnType<typeof createRotation>> | null = null
  try {
    opened = await unlockWithKeys(oldPassphraseKeys, session)
    wipe(opened.rootEntropy)
    rotation = await createRotation({
      newPassphrase: input.newPassphrase,
      argon2id: workerArgon2id,
      oldAccountPrivateKey: opened.accountKeys.accountPrivateKey,
      oldKeyring: opened.oldPrivateKeys,
    })
    // The folder keys and tag records, sealed again for the new account
    // key in the same request (section 8.3.3, step 6).
    const library = resealLibrary(
      opened.accountKeys,
      rotation.accountKeys,
      await readSealedLibrary()
    )
    // Each proof needs a challenge of its own.
    const proofChallenge = await requestSessionChallenge()
    const requestChallenge = await requestSessionChallenge()
    await sendSigned({
      accountPrivateKey: opened.accountKeys.accountPrivateKey,
      challenge: requestChallenge.challenge,
      method: 'POST',
      path: '/api/auth/e2ee/rotation',
      body: {
        account: accountRecordToWire(rotation.record),
        sealedKeyring: sealedKeyringToWire(rotation.sealedKeyring),
        ...library,
        passphraseProof: {
          challenge: proofChallenge.challenge,
          signature: base64urlEncode(
            signInSignature({
              authPrivateKey: oldPassphraseKeys.authPrivateKey,
              challenge: challengeFromWire(proofChallenge.challenge),
              identifier: proofChallenge.identifier,
            })
          ),
        },
      },
    })
    return { mnemonic: rotation.mnemonic }
  } finally {
    wipePassphraseKeys(oldPassphraseKeys)
    if (opened) {
      wipeAccountKeys(opened.accountKeys)
      wipe(...opened.oldPrivateKeys)
    }
    if (rotation) {
      wipePassphraseKeys(rotation.passphraseKeys)
      wipeAccountKeys(rotation.accountKeys)
    }
  }
}

// --- Recovery and reset by email (sections 6.8 and 6.9) ---

export type ResetLink =
  | { readonly hasKeys: false }
  | {
      readonly hasKeys: true
      readonly accountPublicKey: string
      readonly protocolVersion: number
      readonly sealedKeyring: string | null
      readonly challenge: string
      /** The sealed folder keys and tag records, which a recovery seals again. */
      readonly folders?: SealedLibrary['folders']
      readonly tags?: readonly { id: string; sealedTagMetadata: string }[]
    }

/** What an email reset link can do, without using it up. Each call issues a new recovery challenge. */
export function readResetLink(
  token: string,
  signal?: AbortSignal
): Promise<ResetLink> {
  return apiRequest<ResetLink>('/api/auth/e2ee/recovery/challenge', {
    body: { token },
    signal,
    fallback: 'Unable to check this reset link. Please try again.',
  })
}

/**
 * Step 3 of section 6.8, before the person chooses a new passphrase: whether
 * the typed mnemonic gives the account key of the link's account. Throws an
 * `E2eeError` with `invalid_mnemonic` or `key_mismatch`.
 */
export function checkRecoveryPhrase(
  mnemonic: string,
  link: Extract<ResetLink, { hasKeys: true }>
): void {
  wipeAccountKeys(
    accountKeysFromMnemonic(
      mnemonic,
      accountPublicKeyFromWire(link.accountPublicKey)
    )
  )
}

/**
 * Recovery with the mnemonic: a rotation that the email link and a signature
 * of the old account key authorize. The old files stay readable through the
 * keyring. Returns the new mnemonic.
 */
export async function recoverWithRecoveryPhrase(input: {
  readonly token: string
  readonly mnemonic: string
  readonly newPassphrase: string
}): Promise<{ readonly mnemonic: string }> {
  const link = await readResetLink(input.token)
  if (!link.hasKeys)
    throw new Error('This account has no recovery phrase. Start again.')
  assertKnownProtocolVersion(link.protocolVersion)
  const accountPublicKey = accountPublicKeyFromWire(link.accountPublicKey)
  const oldKeys = accountKeysFromMnemonic(input.mnemonic, accountPublicKey)
  let oldKeyring: OpenedAccount['oldPrivateKeys'] = []
  let rotation: Awaited<ReturnType<typeof createRotation>> | null = null
  try {
    const sealedKeyring = sealedKeyringFromWire(link.sealedKeyring)
    if (sealedKeyring)
      oldKeyring = openKeyring({
        accountPrivateKey: oldKeys.accountPrivateKey,
        accountPublicKey,
        sealedKeyring,
      })
    const issued = Date.now()
    rotation = await createRotation({
      newPassphrase: input.newPassphrase,
      argon2id: workerArgon2id,
      oldAccountPrivateKey: oldKeys.accountPrivateKey,
      oldKeyring,
    })
    let challenge = link.challenge
    let sealed = link
    if (Date.now() - issued >= CHALLENGE_FRESH_MS) {
      const again = await readResetLink(input.token)
      if (!again.hasKeys || again.accountPublicKey !== link.accountPublicKey)
        throw new Error('This account changed. Request a new reset link.')
      challenge = again.challenge
      sealed = again
    }
    // A recovery is a rotation: the folder keys and tag records are sealed
    // again for the new account key (section 8.3.3, step 6).
    const library: RotatedLibraryWire = resealLibrary(
      oldKeys,
      rotation.accountKeys,
      {
        folders: sealed.folders ?? [],
        tags: (sealed.tags ?? []).map((tag) => ({
          id: tag.id,
          sealed: tag.sealedTagMetadata,
        })),
      }
    )
    await sendSigned({
      accountPrivateKey: oldKeys.accountPrivateKey,
      challenge,
      method: 'POST',
      path: '/api/auth/e2ee/recovery',
      body: {
        token: input.token,
        account: accountRecordToWire(rotation.record),
        sealedKeyring: sealedKeyringToWire(rotation.sealedKeyring),
        ...library,
      },
    })
    return { mnemonic: rotation.mnemonic }
  } finally {
    wipeAccountKeys(oldKeys)
    wipe(...oldKeyring)
    if (rotation) {
      wipePassphraseKeys(rotation.passphraseKeys)
      wipeAccountKeys(rotation.accountKeys)
    }
  }
}

/**
 * Reset without the mnemonic: new keys from a new `root_entropy`. No key of
 * the account opens its old encrypted files after this. Also gives keys to
 * an account that still has a password. Returns the new mnemonic.
 */
export async function resetWithEmailLink(input: {
  readonly token: string
  readonly newPassphrase: string
}): Promise<{ readonly mnemonic: string }> {
  const account = await createNewAccount({
    passphrase: input.newPassphrase,
    argon2id: workerArgon2id,
  })
  try {
    await apiRequest('/api/auth/e2ee/reset', {
      body: {
        token: input.token,
        account: accountRecordToWire(account.record),
      },
      fallback: 'Unable to reset your passphrase. Please try again.',
    })
    return { mnemonic: account.mnemonic }
  } finally {
    wipePassphraseKeys(account.passphraseKeys)
    wipeAccountKeys(account.accountKeys)
  }
}
