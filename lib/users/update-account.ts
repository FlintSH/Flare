import type { Prisma, User } from '@prisma/client'

import { lockRoleChanges } from '@/lib/database/locks'
import { lockEmailUser } from '@/lib/email/account'
import { withOwnerId } from '@/lib/files/urls'
import { HttpError } from '@/lib/http/errors'

import { changeCredentials } from './credentials'
import { claimEmail } from './email-claim'
import { assertPublicIdsFree } from './public-id-claim'

/** What an edit sets. Fields left undefined keep their values. */
export interface AccountEdit {
  name?: string
  /** A new sign-in address. */
  email?: string
  /** A new password, as `hashAccountPassword` stores it. */
  password?: string
  urlId?: string
  /** Null removes the vanity ID. */
  vanityId?: string | null
  /** Columns with no rules of their own, such as upload defaults. */
  settings?: Prisma.UserUpdateInput
}

/** How each editor is told that an edit can't be saved. */
const refusals = {
  self: {
    changed: 'Account changed during update. Please try again.',
    emailTaken: 'Email already taken',
  },
  // Administrators edit the copy of the account the Users list loaded.
  administrator: {
    changed: 'Account changed during update. Refresh the user and try again.',
    emailTaken: 'Email already exists',
  },
}

export interface AccountEditor {
  kind: keyof typeof refusals
  /** Whether account email is enabled, which makes addresses unique in any letter case. */
  emailEnabled: boolean
  /** Proves the person may make this edit, once the account row is locked. */
  prove?: (account: User) => Promise<void>
  /** Role assignments to save with the edit, decided with the account row locked. */
  roles?: (account: User) => Promise<Prisma.UserUpdateInput['roles']>
}

/**
 * Saves an edit to an account in the caller's transaction. `seen` is the
 * account as the request read it. For every editor:
 *
 * - A change to the address, password or URL ID is refused when another
 *   request changed that field since `seen`, and a new password also when
 *   another request signed the account out since then.
 * - A new URL ID or vanity ID must not name another account as either kind
 *   of ID, and a new address must be free.
 * - A new address or password signs the account out everywhere.
 * - A new URL ID moves the account's file URLs with it, while the stored
 *   files stay where they are.
 */
export async function updateAccount<Select extends Prisma.UserSelect>(
  tx: Prisma.TransactionClient,
  seen: User,
  edit: AccountEdit,
  editor: AccountEditor,
  select: Select
): Promise<Prisma.UserGetPayload<{ select: Select }>> {
  const refuse = refusals[editor.kind]
  const emailChanged = edit.email !== undefined && edit.email !== seen.email
  const urlIdChanged = edit.urlId !== undefined && edit.urlId !== seen.urlId
  const claimsIds = urlIdChanged || Boolean(edit.vanityId)
  // Public IDs are claimed under the role lock, which goes before row locks.
  if (claimsIds) await lockRoleChanges(tx)
  const account = await lockEmailUser(tx, seen.id)
  await editor.prove?.(account)
  if (
    (emailChanged && account.email !== seen.email) ||
    (edit.password !== undefined &&
      (account.password !== seen.password ||
        account.sessionVersion !== seen.sessionVersion)) ||
    (urlIdChanged && account.urlId !== seen.urlId)
  )
    throw new HttpError(400, refuse.changed)
  const urlId = urlIdChanged ? edit.urlId! : account.urlId
  if (claimsIds)
    await assertPublicIdsFree(
      tx,
      {
        id: account.id,
        urlId,
        vanityId:
          edit.vanityId === undefined ? account.vanityId : edit.vanityId,
      },
      { urlId: urlIdChanged, vanityId: Boolean(edit.vanityId) }
    )
  const roles = await editor.roles?.(account)
  if (
    emailChanged &&
    !(await claimEmail(tx, edit.email!, {
      accountId: account.id,
      anyCase: editor.emailEnabled,
    }))
  )
    throw new HttpError(400, refuse.emailTaken)
  const credentials =
    emailChanged || edit.password !== undefined
      ? await changeCredentials(tx, account.id, {
          password: edit.password,
          ...(emailChanged && {
            email: { address: edit.email!, verified: false },
          }),
        })
      : {}
  if (urlIdChanged) {
    // Storage paths stay: moving objects could strand files if a storage or
    // database write failed.
    const files = await tx.file.findMany({
      where: { userId: account.id },
      select: { id: true, urlPath: true },
    })
    for (const file of files)
      await tx.file.update({
        where: { id: file.id },
        data: { urlPath: withOwnerId(file.urlPath, account.urlId, urlId) },
      })
  }
  return tx.user.update({
    where: { id: account.id },
    data: {
      ...credentials,
      ...(edit.name !== undefined && { name: edit.name }),
      ...edit.settings,
      ...(urlIdChanged && { urlId }),
      ...(edit.vanityId !== undefined && { vanityId: edit.vanityId }),
      ...(roles && { roles }),
    },
    select,
  }) as Promise<Prisma.UserGetPayload<{ select: Select }>>
}
