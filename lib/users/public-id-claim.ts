import type { Prisma } from '@prisma/client'
import { customAlphabet } from 'nanoid'

import { HttpError } from '@/lib/http/errors'

import { URL_ID_LENGTH, isReservedPublicId } from './public-id'

type Tx = Prisma.TransactionClient

// File URLs look an account up by URL ID first and by vanity ID second, so
// both columns form one namespace: an ID of either kind names one account.
// Claims are checked with lockRoleChanges held, which puts them in one line:
// account creation and administrator edits hold it already, and
// updateAccount takes it before an owner's own vanity ID is checked.

/** Letters and digits without the look-alikes 0, 1, I, O and l. */
const URL_ID_ALPHABET =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const drawUrlId = customAlphabet(URL_ID_ALPHABET, URL_ID_LENGTH)
/** URL IDs drawn for a new account. Out of 57^5, the first is all but always free. */
const URL_ID_DRAWS = 10

/** Accounts using any of `ids` as their URL ID or vanity ID. */
function holders(tx: Tx, ids: string[]) {
  return tx.user.findMany({
    where: { OR: [{ urlId: { in: ids } }, { vanityId: { in: ids } }] },
    select: { id: true, urlId: true, vanityId: true },
  })
}

/**
 * Refuses the public IDs an edit sets when another account uses them as
 * either kind of ID, or when the account's own URL ID and vanity ID would be
 * the same. `account` holds its IDs as they will be after the edit, and
 * `claims` says which of them the edit sets. Call with lockRoleChanges held.
 */
export async function assertPublicIdsFree(
  tx: Tx,
  account: { id: string; urlId: string; vanityId: string | null },
  claims: { urlId: boolean; vanityId: boolean }
) {
  const urlId = claims.urlId ? account.urlId : null
  const vanityId = claims.vanityId ? account.vanityId : null
  const claimed = [urlId, vanityId].filter((id): id is string => Boolean(id))
  if (!claimed.length) return
  const others = (await holders(tx, claimed)).filter(
    (holder) => holder.id !== account.id
  )
  if (urlId) {
    if (others.some((holder) => holder.urlId === urlId))
      throw new HttpError(400, 'URL ID is already in use')
    if (
      account.vanityId === urlId ||
      others.some((holder) => holder.vanityId === urlId)
    )
      throw new HttpError(
        400,
        'This URL ID conflicts with an existing vanity URL'
      )
  }
  if (vanityId) {
    if (others.some((holder) => holder.vanityId === vanityId))
      throw new HttpError(400, 'This vanity URL is already taken')
    if (
      account.urlId === vanityId ||
      others.some((holder) => holder.urlId === vanityId)
    )
      throw new HttpError(
        400,
        'This vanity URL conflicts with an existing URL ID'
      )
  }
}

/**
 * A URL ID for a new account that no account uses as either kind of ID and
 * that isn't one of Flare's routes. Call with lockRoleChanges held.
 */
export async function newUrlId(tx: Tx) {
  const drawn = Array.from({ length: URL_ID_DRAWS }, () => drawUrlId()).filter(
    (id) => !isReservedPublicId(id)
  )
  const taken = new Set(
    (await holders(tx, drawn)).flatMap((holder) => [
      holder.urlId,
      holder.vanityId,
    ])
  )
  const free = drawn.find((id) => !taken.has(id))
  if (!free) throw new Error(`None of ${URL_ID_DRAWS} new URL IDs was free`)
  return free
}
