import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'
import { type Challenge, base64urlEncode } from '@/lib/e2ee'

/** How long a challenge is valid (docs/e2ee-spec.md, section 6.1). */
export const E2EE_CHALLENGE_SECONDS = 60

/**
 * What a challenge may be presented to. A challenge of one purpose is never
 * accepted by a route of a different purpose.
 *
 * - `e2ee_sign_in`: the passphrase sign-in, for the account of an identifier.
 * - `e2ee_session`: unlock, signed requests and the passphrase proof of a
 *   rotation, for the account of a browser session.
 * - `e2ee_recovery`: the signed request of a recovery, for the account of an
 *   email reset link.
 */
export type E2eeChallengePurpose =
  'e2ee_sign_in' | 'e2ee_session' | 'e2ee_recovery'

type Db = Pick<Prisma.TransactionClient, 'authChallenge' | '$queryRaw'>

/**
 * A new `challenge = random(32)`, valid for one use and for 60 seconds. It is
 * stored under its own text form. `userId` is null for the challenge that an
 * unknown identifier gets: nothing can ever present it with success.
 *
 * An account can have several challenges at a time. A person who requests
 * challenges for the identifier of somebody else thus cannot cancel the
 * sign-in of that account.
 */
export async function issueE2eeChallenge(
  purpose: E2eeChallengePurpose,
  account: { userId: string | null; sessionVersion?: number },
  db: Db = prisma
): Promise<string> {
  const challenge = base64urlEncode(randomBytes(32))
  await db.authChallenge.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  await db.authChallenge.create({
    data: {
      id: challenge,
      purpose,
      challenge,
      userId: account.userId,
      sessionVersion: account.sessionVersion,
      expiresAt: new Date(Date.now() + E2EE_CHALLENGE_SECONDS * 1000),
    },
  })
  return challenge
}

/**
 * Deletes the challenge and says whether it was valid for this purpose,
 * account and session version. The delete comes first and is its own
 * statement: a challenge is gone after its first presentation, valid or not,
 * and also when the request fails later. Two requests that present one
 * challenge at the same time cannot both get `true`. Pass no account to
 * delete the challenge of a request that already failed.
 *
 * Call this outside a transaction that can roll back.
 */
export async function consumeE2eeChallenge(
  challenge: Challenge,
  purpose: E2eeChallengePurpose,
  account: { userId: string; sessionVersion?: number } | null,
  db: Db = prisma
): Promise<boolean> {
  const rows = await db.$queryRaw<
    Array<{
      userId: string | null
      purpose: string
      sessionVersion: number | null
      expiresAt: Date
    }>
  >`
    DELETE FROM "AuthChallenge"
    WHERE "id" = ${base64urlEncode(challenge)} AND "purpose" LIKE 'e2ee\\_%'
    RETURNING "userId", "purpose", "sessionVersion", "expiresAt"
  `
  const row = rows[0]
  return Boolean(
    row &&
    account &&
    // Compared here, with the clock that wrote it: the column has no time
    // zone, and a comparison in SQL would depend on the session's zone.
    row.expiresAt > new Date() &&
    row.purpose === purpose &&
    row.userId === account.userId &&
    (account.sessionVersion === undefined ||
      row.sessionVersion === account.sessionVersion)
  )
}
