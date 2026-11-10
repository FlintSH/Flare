import type { Prisma } from '@prisma/client'
import { hkdfSync } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'
import {
  type Challenge,
  blake3KeyedHash,
  encodeIdentifier,
  normalizeIdentifier,
  verifySignInSignature,
  verifyUnlockSignature,
} from '@/lib/e2ee'

import { type E2eeChallengePurpose, consumeE2eeChallenge } from './challenges'
import { asAuthPublicKey } from './records'

type Lookup = Pick<Prisma.TransactionClient, 'user'>

/** The longest identifier a sign-in request can carry: a mailbox address. */
export const IDENTIFIER_MAX_LENGTH = 320

/**
 * The identifier of an account: its sign-in address. Each signature of the
 * sign-in key pair binds to it in the form of docs/e2ee-spec.md, section
 * 4.4, rule 7, which `normalizeIdentifier` gives.
 */
export function accountIdentifier(account: { email: string | null }) {
  return account.email === null ? null : normalizeIdentifier(account.email)
}

/**
 * The account that an identifier names, or null. Any spelling with the same
 * normalized form (letter case, outer white space, NFKC) reaches the same
 * account.
 *
 * Older instances can hold addresses that differ only in letter case. Such
 * accounts have one normalized form. The account whose stored address is the
 * typed one, letter for letter, then wins. If none is, the identifier names
 * nobody.
 */
export async function findAccountByIdentifier(db: Lookup, identifier: string) {
  const normalized = normalizeIdentifier(identifier)
  if (!normalized || normalized.length > IDENTIFIER_MAX_LENGTH) return null
  const candidates = await db.user.findMany({
    where: {
      email: {
        // Prisma compares insensitively with ILIKE: keep LIKE's special
        // characters literal.
        equals: normalized.replace(/[\\%_]/g, (character) => `\\${character}`),
        mode: 'insensitive',
      },
    },
    take: 10,
  })
  const matches = candidates.filter(
    (candidate) => accountIdentifier(candidate) === normalized
  )
  if (matches.length <= 1) return matches[0] ?? null
  const typed = identifier.normalize('NFKC').replace(OUTER_WHITE_SPACE, '')
  const exact = matches.filter((candidate) => candidate.email === typed)
  return exact.length === 1 ? exact[0] : null
}

const OUTER_WHITE_SPACE = /^\p{White_Space}+|\p{White_Space}+$/gu

let fakeSaltKey: { secret: string; key: Uint8Array } | undefined

/**
 * `server_secret` of section 6.1. It comes from NEXTAUTH_SECRET through HKDF
 * with its own label, so it is not a key of any other feature. A new
 * NEXTAUTH_SECRET gives new fake salts.
 */
function serverSecret() {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Authentication secret unavailable.')
  if (fakeSaltKey?.secret !== secret)
    fakeSaltKey = {
      secret,
      key: new Uint8Array(
        hkdfSync(
          'sha256',
          secret,
          'flare-e2ee-v1',
          'unknown-identifier-passphrase-salt',
          32
        )
      ),
    }
  return fakeSaltKey.key
}

/**
 * The salt that an unknown identifier gets (section 6.1):
 * `blake3_keyed_hash(server_secret, identifier)`. The same identifier always
 * gets the same salt, as a real account does.
 */
export function fakePassphraseSalt(identifier: string): Uint8Array {
  return blake3KeyedHash(serverSecret(), encodeIdentifier(identifier))
}

/** The Ed25519 base point: a valid public key that verifies in place of a missing one. Nobody signs in with it. */
const NO_ACCOUNT_KEY = Uint8Array.from([
  0x58,
  ...new Array<number>(31).fill(0x66),
])

/** A signature of the sign-in key pair on a challenge. */
export interface AuthKeyProof {
  challenge: Uint8Array
  signature: Uint8Array
}

const authKeyVerifiers = {
  'sign-in': verifySignInSignature,
  unlock: verifyUnlockSignature,
}

/**
 * Deletes the challenge of the proof, then says whether the proof is a valid
 * signature of that kind by the sign-in key of the account (sections 6.2 and
 * 6.3). The two kinds have different context strings: a signature for one
 * request is never valid for the other.
 */
export async function verifyAuthKeyProof(
  kind: keyof typeof authKeyVerifiers,
  proof: AuthKeyProof,
  purpose: E2eeChallengePurpose,
  account: {
    id: string
    email: string | null
    authPublicKey: Uint8Array | null
    sessionVersion?: number
  } | null,
  db: Parameters<typeof consumeE2eeChallenge>[3] = prisma
): Promise<boolean> {
  const fresh = await consumeE2eeChallenge(
    proof.challenge as Challenge,
    purpose,
    account && {
      userId: account.id,
      sessionVersion: account.sessionVersion,
    },
    db
  )
  const identifier = account && accountIdentifier(account)
  const usable = fresh && account?.authPublicKey && identifier
  // A request that cannot succeed still pays for one verification, so the
  // time of the answer does not say whether the identifier names an account.
  const valid = authKeyVerifiers[kind]({
    authPublicKey: asAuthPublicKey(
      usable ? account.authPublicKey! : NO_ACCOUNT_KEY
    ),
    challenge: proof.challenge as Challenge,
    identifier: usable ? identifier : '',
    signature: proof.signature,
  })
  return Boolean(usable) && valid
}
