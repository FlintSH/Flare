import {
  type AccountKeys,
  type AccountRecord,
  type PassphraseKeys,
  accountKeysFromPrivateKey,
  deriveAccountKeys,
  derivePassphraseKeys,
  mnemonicFromRootEntropy,
  openKeyring,
  rootEntropyFromMnemonic,
  unwrapRoot,
} from '../account'
import { PROTOCOL_VERSION } from '../contexts'
import { E2eeError } from '../errors'
import type { Argon2id } from '../kdf'
import { constantTimeEqual, wipe } from '../primitives'
import {
  generatePassphraseSalt,
  generateRootEntropy,
  sealKeyringWithRandomNonce,
  wrapRootWithRandomNonce,
} from '../random'
import type { AccountPrivateKey, AccountPublicKey, RootEntropy } from '../types'

// The procedures of the browser client, made from the functions of
// `lib/e2ee`. Each one is deterministic except for the random values that
// `random.ts` draws. None of them talks to the server.

/** The server refuses a keyring with more old keys (lib/auth/e2ee/records.ts). */
export const MAX_KEYRING_KEYS = 64

/** A new account record with the secrets that the client needs directly after it. */
export interface NewAccount {
  readonly record: AccountRecord
  readonly accountKeys: AccountKeys
  /**
   * The sign-in key pair and `wrap_key` of the new passphrase. The client
   * signs in with them without a second Argon2id, then erases them.
   */
  readonly passphraseKeys: PassphraseKeys
  /** The caller shows it one time and drops it. */
  readonly mnemonic: string
}

/**
 * Account creation (docs/e2ee-spec.md, section 5.4, steps 1 to 6) for a
 * client that signs in next. It is `createRandomAccount` of `lib/e2ee`,
 * except that it returns the passphrase keys: section 6.2 lets the client
 * use the keys that it has in memory in place of a second Argon2id.
 * `root_entropy` is erased here. The caller erases `passphraseKeys`.
 */
export async function createNewAccount(input: {
  readonly passphrase: string
  readonly argon2id: Argon2id
}): Promise<NewAccount> {
  const passphraseSalt = generatePassphraseSalt()
  const passphraseKeys = await derivePassphraseKeys({
    passphrase: input.passphrase,
    passphraseSalt,
    argon2id: input.argon2id,
  })
  const rootEntropy = generateRootEntropy()
  try {
    const accountKeys = deriveAccountKeys(rootEntropy)
    return {
      record: {
        accountPublicKey: accountKeys.accountPublicKey,
        passphraseSalt,
        protocolVersion: PROTOCOL_VERSION,
        authPublicKey: passphraseKeys.authPublicKey,
        wrappedRoot: wrapRootWithRandomNonce({
          wrapKey: passphraseKeys.wrapKey,
          accountPublicKey: accountKeys.accountPublicKey,
          rootEntropy,
        }),
      },
      accountKeys,
      passphraseKeys,
      mnemonic: mnemonicFromRootEntropy(rootEntropy),
    }
  } finally {
    wipe(rootEntropy)
  }
}

/** Erases the secret halves of passphrase keys. Call it as soon as the last signature is made. */
export function wipePassphraseKeys(keys: PassphraseKeys | null | undefined) {
  if (keys) wipe(keys.authPrivateKey, keys.wrapKey)
}

/** Erases the secret halves of account keys that will not be stored. */
export function wipeAccountKeys(keys: AccountKeys | null | undefined) {
  if (keys) wipe(keys.accountPrivateKey, keys.exchangePrivateKey)
}

/** What the unlock route released, opened (section 6.3, steps 7 to 9). */
export interface OpenedAccount {
  readonly accountKeys: AccountKeys
  /** The old private keys of the keyring, newest first. Empty with no keyring. */
  readonly oldPrivateKeys: AccountPrivateKey[]
  /** The caller erases it after the last use, such as the display of the mnemonic. */
  readonly rootEntropy: RootEntropy
}

/**
 * Opens `wrapped_root` with `wrap_key`, checks the account key against the
 * public key of the record, and opens the keyring. A wrong `wrap_key` fails
 * with `tag_mismatch`.
 */
export function openAccount(input: {
  readonly passphraseKeys: Pick<PassphraseKeys, 'wrapKey'>
  readonly accountPublicKey: AccountPublicKey
  readonly wrappedRoot: Uint8Array
  readonly sealedKeyring: Uint8Array | null
}): OpenedAccount {
  const { rootEntropy, accountKeys } = unwrapRoot({
    wrapKey: input.passphraseKeys.wrapKey,
    accountPublicKey: input.accountPublicKey,
    wrappedRoot: input.wrappedRoot,
  })
  try {
    return {
      accountKeys,
      rootEntropy,
      oldPrivateKeys: input.sealedKeyring
        ? openKeyring({
            accountPrivateKey: accountKeys.accountPrivateKey,
            accountPublicKey: accountKeys.accountPublicKey,
            sealedKeyring: input.sealedKeyring,
          })
        : [],
    }
  } catch (error) {
    wipe(rootEntropy)
    wipeAccountKeys(accountKeys)
    throw error
  }
}

/**
 * Recovery, steps 2 and 3 of section 6.8: the account keys that a typed
 * mnemonic gives, checked against the public key that the server stores.
 * A mnemonic of a different account fails with `key_mismatch`.
 */
export function accountKeysFromMnemonic(
  mnemonic: string,
  accountPublicKey: AccountPublicKey
): AccountKeys {
  const rootEntropy = rootEntropyFromMnemonic(mnemonic)
  try {
    const accountKeys = deriveAccountKeys(rootEntropy)
    if (!constantTimeEqual(accountKeys.accountPublicKey, accountPublicKey)) {
      wipeAccountKeys(accountKeys)
      throw new E2eeError(
        'key_mismatch',
        'The mnemonic does not give the account_public_key of the account'
      )
    }
    return accountKeys
  } finally {
    wipe(rootEntropy)
  }
}

/** What a rotation request carries besides its proofs (section 8.3.3, steps 3 to 5). */
export interface Rotation extends NewAccount {
  /** `sealed_keyring` for the new account key. It holds the old key and the keys of the old keyring. */
  readonly sealedKeyring: Uint8Array
}

/**
 * Steps 3 to 5 of the rotation procedure: a new account record from a new
 * `root_entropy`, and a keyring for the new key that holds the old account
 * private key followed by the keys of the old keyring, newest first.
 */
export async function createRotation(input: {
  readonly newPassphrase: string
  readonly argon2id: Argon2id
  readonly oldAccountPrivateKey: AccountPrivateKey
  readonly oldKeyring: readonly AccountPrivateKey[]
}): Promise<Rotation> {
  const oldPrivateKeys = [input.oldAccountPrivateKey, ...input.oldKeyring]
  if (oldPrivateKeys.length > MAX_KEYRING_KEYS)
    throw new E2eeError(
      'invalid_argument',
      'The keyring cannot hold another old private key'
    )
  // Checks each old key before the slow step.
  oldPrivateKeys.forEach((key) =>
    wipe(accountKeysFromPrivateKey(key).exchangePrivateKey)
  )
  const account = await createNewAccount({
    passphrase: input.newPassphrase,
    argon2id: input.argon2id,
  })
  return {
    ...account,
    sealedKeyring: sealKeyringWithRandomNonce({
      accountPrivateKey: account.accountKeys.accountPrivateKey,
      accountPublicKey: account.accountKeys.accountPublicKey,
      oldPrivateKeys,
    }),
  }
}
