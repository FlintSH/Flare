import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { validateOwnedFolderId } from '@/lib/folders/service'
import { HttpError } from '@/lib/http/errors'
import { parseInput } from '@/lib/http/request'
import { hasPermission } from '@/lib/permissions/catalog'
import { validateOwnedTagIds } from '@/lib/tags/service'

import {
  accountUploadOptions,
  effectiveUploadRevision,
} from './effective-settings'
import { findOwnedProfile, missingUploadProfile } from './profiles'
import {
  type ResolvedUploadOptions,
  type UploadRequestOptions,
  mergeUploadOptions,
  namingChoice,
  uploadProfileOptionsSchema,
  uploadRequestOptionFields,
  uploadRequestOptionsSchema,
} from './schema'

export { uploadProfileOptionsSchema } from './schema'
export type { UploadProfileOptions, ResolvedUploadOptions } from './schema'

export class UploadError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message)
    this.name = 'UploadError'
  }
}

/** Read controls before streaming; profile/naming cannot depend on multipart order. */
export function requestUploadOptions(req: Request): UploadRequestOptions {
  const searchParams = new URL(req.url).searchParams
  const header = req.headers.get('x-upload-profile')
  const query = searchParams.get('profileId')
  if (header && query && header !== query)
    throw new UploadError('Conflicting upload profile selections.')
  const value = header ?? query
  const folderHeader = req.headers.get('x-upload-folder')
  const folderQuery = searchParams.get('folderId')
  if (folderHeader && folderQuery && folderHeader !== folderQuery)
    throw new UploadError('Conflicting upload folder selections.')
  const folder = folderHeader ?? folderQuery
  const patternHeader = req.headers.get('x-upload-name-template')
  const patternQuery = searchParams.get('nameTemplate')
  if (patternHeader && patternQuery && patternHeader !== patternQuery)
    throw new UploadError('Conflicting name pattern selections.')
  const pattern = patternHeader ?? patternQuery
  return parseInput(uploadRequestOptionsSchema, {
    ...(pattern ? { nameTemplate: pattern } : {}),
    ...(value ? { profileId: value === 'none' ? null : value } : {}),
    ...(folder ? { folderId: folder === 'none' ? null : folder } : {}),
  })
}

/** Multipart values are strings; preserve explicit null/disabled versus inheritance. */
export function parseUploadFields(
  fields: Record<string, string>
): UploadRequestOptions {
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(uploadRequestOptionFields)) {
    if (fields[key] === undefined) continue
    // An empty pattern field chooses nothing, like an empty header.
    if (key === 'nameTemplate' && fields[key] === '') continue
    if (key === 'tagIds') {
      try {
        values[key] = JSON.parse(fields[key])
      } catch {
        throw new UploadError('Tags must be a JSON array of tag IDs.')
      }
      continue
    }
    values[key] =
      key === 'randomizeFileUrls'
        ? fields[key] === 'true'
          ? true
          : fields[key] === 'false'
            ? false
            : fields[key]
        : ['password', 'expiresAt', 'profileId', 'folderId'].includes(key) &&
            (fields[key] === '' || fields[key] === 'null')
          ? null
          : fields[key]
  }
  return parseInput(uploadRequestOptionsSchema, values)
}

function sameOption(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    const selected = new Set(left)
    return (
      selected.size === new Set(right).size &&
      right.every((id) => selected.has(id))
    )
  }
  return left === right
}

export async function resolveUploadOptions(
  user: AuthenticatedUser,
  input: UploadRequestOptions = {},
  now = new Date()
): Promise<ResolvedUploadOptions> {
  const request = parseInput(uploadRequestOptionsSchema, input)
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      randomizeFileUrls: true,
      defaultFileExpiration: true,
      defaultFileExpirationAction: true,
      defaultUploadProfileId: true,
    },
  })
  if (!account) throw new UploadError('Account no longer exists.', 401)
  const boundProfile = user.apiToken?.profileId
  if (
    boundProfile &&
    request.profileId !== undefined &&
    request.profileId !== boundProfile
  )
    throw new UploadError(
      'This token is restricted to its upload profile.',
      403
    )
  const profileId =
    boundProfile ??
    (request.profileId !== undefined
      ? request.profileId
      : account.defaultUploadProfileId)
  const profile = profileId
    ? await findOwnedProfile(prisma, user.id, profileId, missingUploadProfile)
    : null
  const profileOptions = profile
    ? uploadProfileOptionsSchema.parse(profile.options)
    : {}
  const config = await getConfig()
  const defaults = accountUploadOptions(account, config)
  if (boundProfile) {
    const bound = mergeUploadOptions(defaults, profileOptions, {}, now)
    // Compared as merged, because one naming option can undo the other.
    const { expiresAt: _expiresAt, ...choices } = request
    const asked = mergeUploadOptions(defaults, profileOptions, choices, now)
    for (const key of Object.keys(
      uploadProfileOptionsSchema.shape
    ) as (keyof typeof profileOptions)[]) {
      if (!sameOption(asked[key], bound[key]))
        throw new UploadError(
          'This token cannot override its upload profile.',
          403
        )
    }
    if (request.expiresAt !== undefined)
      throw new UploadError(
        'This token cannot override its profile expiration.',
        403
      )
  }
  const resolved = mergeUploadOptions(defaults, profileOptions, request, now)
  return {
    ...resolved,
    folderId: await validateOwnedFolderId(user.id, request.folderId ?? null),
    tagIds: await validateOwnedTagIds(user.id, resolved.tagIds),
    profileId: profile?.id ?? null,
    profileRevision: profile?.updatedAt.toISOString() ?? null,
    profileEffectiveRevision: profile
      ? effectiveUploadRevision(
          user.id,
          profile.id,
          defaults,
          profileOptions,
          hasPermission(user, 'files.share')
        )
      : null,
  }
}

export function applyUploadOverrides(
  user: AuthenticatedUser,
  resolved: ResolvedUploadOptions,
  input: UploadRequestOptions
): ResolvedUploadOptions {
  const request = parseInput(uploadRequestOptionsSchema, input)
  if (
    request.folderId !== undefined &&
    request.folderId !== (resolved.folderId ?? null)
  )
    throw new UploadError(
      'The upload folder cannot change after upload starts. Select it using X-Upload-Folder before uploading.'
    )
  if (
    request.profileId !== undefined &&
    request.profileId !== resolved.profileId
  )
    throw new UploadError(
      'The upload profile cannot change after upload starts.',
      403
    )
  const naming = namingChoice(request)
  if (
    naming.randomizeFileUrls !== undefined &&
    (naming.randomizeFileUrls !== resolved.randomizeFileUrls ||
      naming.nameTemplate !== (resolved.nameTemplate ?? null))
  )
    throw new UploadError(
      'The naming strategy cannot change after upload starts.'
    )
  if (user.apiToken?.profileId) {
    for (const key of Object.keys(
      uploadProfileOptionsSchema.shape
    ) as (keyof typeof resolved)[]) {
      if (
        key in request &&
        !sameOption(
          request[key as keyof UploadRequestOptions],
          resolved[key as keyof ResolvedUploadOptions]
        )
      )
        throw new UploadError(
          'This token cannot override its upload profile.',
          403
        )
    }
    if (request.expiresAt !== undefined)
      throw new UploadError(
        'This token cannot override its profile expiration.',
        403
      )
  }
  const merged = mergeUploadOptions({}, resolved, {
    ...request,
    expiresAt:
      request.expiresAt !== undefined
        ? request.expiresAt
        : request.expiration !== undefined
          ? undefined
          : resolved.expiresAt,
  })
  return {
    ...merged,
    folderId: resolved.folderId ?? null,
    profileId: resolved.profileId,
    profileRevision: resolved.profileRevision,
    password:
      request.password !== undefined ? request.password : resolved.password,
  }
}
