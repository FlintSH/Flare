import { z } from 'zod'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import {
  sameStoredBytes,
  storedRecordField,
  wireBytes,
} from '@/lib/library/sealed-fields'

/**
 * The stanza migration after a key rotation (docs/e2ee-spec.md, section
 * 8.3.4). Each account stanza records the account public key that it is
 * for. The owner's browser asks for a batch of stanzas for an old key,
 * opens each with that key from its keyring, makes a stanza for the current
 * key and sends the batch back. The server only replaces records: it never
 * has a private key or a file key.
 *
 * A file that no key of the account opens (after a reset without the
 * mnemonic) is not part of it.
 */

export const STANZA_BATCH_SIZE = 100

/** The stanzas that are still for an old account key, and which old keys those are. */
export async function oldAccountStanzas(
  userId: string,
  /** Lists the stanzas of files after this ID, past ones a browser could not open. */
  after: string | null = null
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountPublicKey: true },
  })
  if (!user?.accountPublicKey) return { stanzas: [], remaining: 0, oldKeys: [] }
  const current = Uint8Array.from(user.accountPublicKey)
  const where = {
    userId,
    encrypted: true,
    unreadable: false,
    stanzaAccountPublicKey: { not: current },
  }
  const [remaining, files, keys] = await Promise.all([
    prisma.file.count({ where }),
    prisma.file.findMany({
      where: { ...where, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: STANZA_BATCH_SIZE,
      select: {
        id: true,
        header: true,
        sealedMetadata: true,
        accountStanza: true,
        stanzaAccountPublicKey: true,
      },
    }),
    prisma.file.findMany({
      where,
      distinct: ['stanzaAccountPublicKey'],
      select: { stanzaAccountPublicKey: true },
    }),
  ])
  return {
    stanzas: files.map((file) => ({
      id: file.id,
      header: wireBytes(file.header)!,
      sealedMetadata: wireBytes(file.sealedMetadata)!,
      accountStanza: wireBytes(file.accountStanza)!,
      stanzaAccountPublicKey: wireBytes(file.stanzaAccountPublicKey)!,
    })),
    remaining,
    /** The old account public keys that still have a stanza. A keyring keeps their private keys. */
    oldKeys: keys.map((file) => wireBytes(file.stanzaAccountPublicKey)!),
  }
}

export const accountStanzasSchema = z.strictObject({
  /** The account public key that every stanza of this request is for. */
  stanzaAccountPublicKey: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]+$/),
  stanzas: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        accountStanza: storedRecordField('account_stanza', 96),
      })
    )
    .min(1)
    .max(STANZA_BATCH_SIZE),
})

/**
 * Replaces account stanzas with ones for the current account key. A batch
 * for any other key is refused, as an upload for an old key is (section
 * 8.3.6): a rotation may have passed while the browser worked.
 */
export async function replaceAccountStanzas(
  userId: string,
  input: z.infer<typeof accountStanzasSchema>
) {
  const sentKey = Uint8Array.from(
    Buffer.from(input.stanzaAccountPublicKey, 'base64url')
  )
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { accountPublicKey: true },
    })
    if (!sameStoredBytes(user?.accountPublicKey, sentKey))
      throw new HttpError(
        409,
        'These stanzas are for a different account key. Reload the page and try again.',
        { body: { code: 'stale_account_key' } }
      )
    let replaced = 0
    for (const stanza of input.stanzas) {
      // Only a stanza of an older key is replaced. A stanza that is for
      // the current key already opens the file: a request that replaces it
      // could only destroy the file key.
      const changed = await tx.file.updateMany({
        where: {
          id: stanza.id,
          userId,
          encrypted: true,
          unreadable: false,
          NOT: { stanzaAccountPublicKey: sentKey },
        },
        data: {
          accountStanza: stanza.accountStanza,
          stanzaAccountPublicKey: sentKey,
        },
      })
      replaced += changed.count
    }
    return { replaced }
  })
}
