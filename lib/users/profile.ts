import { UpdateProfileSchema } from '@/types/dto/profile'
import type { Prisma, User } from '@prisma/client'
import type { z } from 'zod'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'

import { type AccountEditor, updateAccount } from './update-account'

/**
 * What an account may change about itself without proving again who it is:
 * everything `PUT /api/profile` takes except the address and the password.
 */
export const profileSettingsSchema = UpdateProfileSchema.pick({
  name: true,
  vanityId: true,
  randomizeFileUrls: true,
  defaultFileExpiration: true,
  defaultFileExpirationAction: true,
})
export type ProfileSettings = z.infer<typeof profileSettingsSchema>

/** A change to how the account signs in. Only the profile route makes one. */
export interface CredentialChange {
  email?: string
  /** A new password, as `hashAccountPassword` stores it. */
  password?: string
  /** Whether account email is enabled, which decides how an address is claimed. */
  emailEnabled: boolean
  /** Proves the person may make the change, once the account row is locked. */
  prove?: AccountEditor['prove']
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  randomizeFileUrls: true,
  vanityId: true,
} satisfies Prisma.UserSelect

/** The account as a request reads it before editing it. */
export async function accountToEdit(userId: string): Promise<User> {
  const account = await prisma.user.findUnique({ where: { id: userId } })
  if (!account) throw new HttpError(404, 'User not found')
  return account
}

/**
 * Saves an account's edit of its own profile in the caller's transaction.
 * `seen` is the account as the request read it. Settings left undefined keep
 * their values.
 */
export function saveProfile(
  tx: Prisma.TransactionClient,
  seen: User,
  settings: ProfileSettings,
  credentials: CredentialChange = { emailEnabled: false }
) {
  return updateAccount(
    tx,
    seen,
    {
      name: settings.name,
      email: credentials.email,
      password: credentials.password,
      vanityId: settings.vanityId,
      settings: {
        ...(typeof settings.randomizeFileUrls === 'boolean' && {
          randomizeFileUrls: settings.randomizeFileUrls,
        }),
        ...(settings.defaultFileExpiration && {
          defaultFileExpiration: settings.defaultFileExpiration,
        }),
        ...(settings.defaultFileExpirationAction && {
          defaultFileExpirationAction: settings.defaultFileExpirationAction,
        }),
      },
    },
    {
      kind: 'self',
      emailEnabled: credentials.emailEnabled,
      prove: credentials.prove,
    },
    profileSelect
  )
}

/**
 * Saves profile settings alone, for a caller that cannot change how the
 * account signs in: no address and no password. `prove` can still refuse the
 * settings, judged with the role lock and the account row held.
 */
export function updateProfileSettings(
  seen: User,
  settings: ProfileSettings,
  prove?: AccountEditor['prove']
) {
  return prisma.$transaction(async (tx) => {
    // The role lock goes before row locks, and a proof reads roles.
    if (prove) await lockRoleChanges(tx)
    return saveProfile(tx, seen, settings, { emailEnabled: false, prove })
  })
}
