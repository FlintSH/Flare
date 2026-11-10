import type { Prisma } from '@prisma/client'

import { getConfig } from '@/lib/config'
import { lockUploadProfiles } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import {
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'
import { validateOwnedTagIds } from '@/lib/tags/service'

import {
  accountUploadOptions,
  effectiveUploadRevision,
} from './effective-settings'
import { plainUploadsForbidden } from './encryption-policy'
import {
  type UploadProfileInput,
  type UploadProfileOptions,
  mergeUploadOptions,
  uploadProfileOptionsSchema,
  uploadRecipe,
} from './schema'

export function profileView(profile: {
  id: string
  name: string
  options: unknown
  updatedAt: Date
}) {
  return {
    id: profile.id,
    name: profile.name,
    options: uploadProfileOptionsSchema.parse(profile.options),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

/** A profile id that isn't one of the account's profiles. */
export class ProfileNotFoundError extends HttpError {
  constructor(message = 'Profile not found.') {
    super(404, message)
    this.name = 'ProfileNotFoundError'
  }
}

/** Uploads and the uploader clients have always named the kind of profile. */
export const missingUploadProfile = () =>
  new ProfileNotFoundError('Upload profile not found.')

/**
 * One of the account's profiles. Any other id throws `missing()`, so each
 * caller keeps the answer its requests have always given.
 */
export async function findOwnedProfile(
  db: Pick<Prisma.TransactionClient, 'uploadProfile'>,
  userId: string,
  id: string,
  missing: () => Error = () => new ProfileNotFoundError()
) {
  const profile = await db.uploadProfile.findFirst({ where: { id, userId } })
  if (!profile) throw missing()
  return profile
}

export async function generatorProfile(
  userId: string,
  selected?: string | null
) {
  if (!selected) return null
  const { id, name } = await findOwnedProfile(
    prisma,
    userId,
    selected,
    missingUploadProfile
  )
  return { id, name }
}

export async function listProfiles(user: PermissionSubject & { id: string }) {
  const [profiles, account] = await Promise.all([
    prisma.uploadProfile.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        defaultUploadProfileId: true,
        randomizeFileUrls: true,
        defaultFileExpiration: true,
        defaultFileExpirationAction: true,
      },
    }),
  ])
  if (!account) throw new HttpError(401, 'Account no longer exists.')
  const config = await getConfig()
  const accountOptions = accountUploadOptions(account, config)
  const canShare = hasPermission(user, 'files.share')
  const selected = profiles.find(
    (profile) => profile.id === account.defaultUploadProfileId
  )
  const effective = mergeUploadOptions(
    accountOptions,
    selected ? uploadProfileOptionsSchema.parse(selected.options) : {},
    {}
  )
  return {
    profiles: profiles.map((profile) => {
      const view = profileView(profile)
      return {
        ...view,
        effectiveRevision: effectiveUploadRevision(
          user.id,
          profile.id,
          accountOptions,
          view.options,
          canShare
        ),
      }
    }),
    defaultProfileId: account.defaultUploadProfileId,
    accountOptions,
    canShare,
    effective,
    plainUploadsForbidden: plainUploadsForbidden(config),
  }
}

function changeProfiles<T>(
  userId: string,
  change: (tx: Prisma.TransactionClient) => Promise<T>
) {
  return prisma.$transaction(async (tx) => {
    await lockUploadProfiles(tx, userId)
    return change(tx)
  })
}

/** The caller holds `lockUploadProfiles`. */
async function withOwnedTags(
  tx: Prisma.TransactionClient,
  userId: string,
  options: UploadProfileOptions
) {
  return options.tagIds
    ? {
        ...options,
        tagIds: await validateOwnedTagIds(userId, options.tagIds, tx),
      }
    : options
}

export async function createProfile(
  userId: string,
  { name, options }: UploadProfileInput
) {
  const profile = await changeProfiles(userId, async (tx) =>
    tx.uploadProfile.create({
      data: { userId, name, options: await withOwnedTags(tx, userId, options) },
    })
  )
  return profileView(profile)
}

/** Saves only while the profile is at `revision`, the `updatedAt` its editor loaded. */
export async function updateProfile(
  userId: string,
  id: string,
  revision: string,
  { name, options }: UploadProfileInput
) {
  const profile = await changeProfiles(userId, async (tx) => {
    const result = await tx.uploadProfile.updateMany({
      where: { id, userId, updatedAt: new Date(revision) },
      data: { name, options: await withOwnedTags(tx, userId, options) },
    })
    if (!result.count) return null
    return tx.uploadProfile.findUniqueOrThrow({ where: { id } })
  })
  if (!profile)
    throw new HttpError(
      409,
      'Profile changed or was removed. Reload it before saving.'
    )
  return profileView(profile)
}

export async function deleteProfile(userId: string, id: string) {
  await changeProfiles(userId, async (tx) => {
    await tx.user.updateMany({
      where: { id: userId, defaultUploadProfileId: id },
      data: { defaultUploadProfileId: null },
    })
    await tx.uploadProfile.deleteMany({ where: { id, userId } })
  })
}

/** The profile uploads use when they select none; null for account settings only. */
export async function setDefaultProfile(
  userId: string,
  profileId: string | null
) {
  await changeProfiles(userId, async (tx) => {
    if (profileId) await findOwnedProfile(tx, userId, profileId)
    await tx.user.update({
      where: { id: userId },
      data: { defaultUploadProfileId: profileId },
    })
  })
}

export async function profileRecipe(userId: string, id: string) {
  return uploadRecipe(profileView(await findOwnedProfile(prisma, userId, id)))
}

/**
 * Takes a deleted tag out of the profiles that select it, leaving their other
 * options as saved, so the profiles stay usable. Each one it changes gets a new
 * revision, so an editor open on it reloads before saving. Run it in the
 * transaction that deletes the tag, after `lockUploadProfiles`.
 */
export async function removeTagFromProfiles(
  tx: Prisma.TransactionClient,
  userId: string,
  tagId: string
) {
  const profiles = await tx.uploadProfile.findMany({
    where: { userId },
    select: { id: true, options: true },
  })
  for (const { id, options } of profiles) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      continue
    if (!Array.isArray(options.tagIds) || !options.tagIds.includes(tagId))
      continue
    await tx.uploadProfile.update({
      where: { id },
      data: {
        options: {
          ...options,
          tagIds: options.tagIds.filter((selected) => selected !== tagId),
        },
      },
    })
  }
}
