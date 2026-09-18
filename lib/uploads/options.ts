import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { TagError, validateOwnedTagIds } from '@/lib/tags/service'

import {
  type ResolvedUploadOptions,
  type UploadRequestOptions,
  mergeUploadOptions,
  uploadProfileOptionsSchema,
  uploadRequestOptionsSchema,
} from './schema'

export { uploadProfileOptionsSchema } from './schema'
export type { UploadProfileOptions, ResolvedUploadOptions } from './schema'

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

/** Read controls before streaming; profile/naming cannot depend on multipart order. */
export function requestUploadOptions(req: Request): UploadRequestOptions {
  const header = req.headers.get('x-upload-profile')
  const query = new URL(req.url).searchParams.get('profileId')
  if (header && query && header !== query)
    throw new UploadError('Conflicting upload profile selections.')
  const value = header ?? query
  return value
    ? uploadRequestOptionsSchema.parse({
        profileId: value === 'none' ? null : value,
      })
    : {}
}

/** Multipart values are strings; preserve explicit null/disabled versus inheritance. */
export function parseUploadFields(
  fields: Record<string, string>
): UploadRequestOptions {
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(uploadRequestOptionsSchema.innerType().shape)) {
    if (fields[key] === undefined) continue
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
        : ['password', 'expiresAt', 'profileId'].includes(key) &&
            (fields[key] === '' || fields[key] === 'null')
          ? null
          : fields[key]
  }
  return uploadRequestOptionsSchema.parse(values)
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
  const request = uploadRequestOptionsSchema.parse(input)
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
    ? await prisma.uploadProfile.findFirst({
        where: { id: profileId, userId: user.id },
      })
    : null
  if (profileId && !profile)
    throw new UploadError('Upload profile not found.', 404)
  const profileOptions = profile
    ? uploadProfileOptionsSchema.parse(profile.options)
    : {}
  const config = await getConfig()
  const defaults = {
    shareStyle: config.settings.customization.published.sharing.defaultStyle,
    randomizeFileUrls: account.randomizeFileUrls,
    expiration: account.defaultFileExpiration,
    expiryAction: account.defaultFileExpirationAction,
  }
  if (boundProfile) {
    const bound = mergeUploadOptions(defaults, profileOptions, {}, now)
    for (const key of Object.keys(
      uploadProfileOptionsSchema.innerType().shape
    ) as (keyof typeof profileOptions)[]) {
      if (request[key] !== undefined && !sameOption(request[key], bound[key]))
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
  let resolved: ResolvedUploadOptions
  try {
    resolved = mergeUploadOptions(defaults, profileOptions, request, now)
  } catch (error) {
    throw new UploadError(
      error instanceof Error ? error.message : 'Invalid upload options.'
    )
  }
  return {
    ...resolved,
    tagIds: await validateOwnedTagIds(user.id, resolved.tagIds),
    profileId: profile?.id ?? null,
    profileRevision: profile?.updatedAt.toISOString() ?? null,
  }
}

export function applyUploadOverrides(
  user: AuthenticatedUser,
  resolved: ResolvedUploadOptions,
  input: UploadRequestOptions
): ResolvedUploadOptions {
  const request = uploadRequestOptionsSchema.parse(input)
  if (
    request.profileId !== undefined &&
    request.profileId !== resolved.profileId
  )
    throw new UploadError(
      'The upload profile cannot change after upload starts.',
      403
    )
  if (
    request.randomizeFileUrls !== undefined &&
    request.randomizeFileUrls !== resolved.randomizeFileUrls
  )
    throw new UploadError(
      'The naming strategy cannot change after upload starts.'
    )
  if (user.apiToken?.profileId) {
    for (const key of Object.keys(
      uploadProfileOptionsSchema.innerType().shape
    ) as (keyof typeof resolved)[]) {
      if (
        key in request &&
        !sameOption(request[key as keyof UploadRequestOptions], resolved[key])
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
  let merged: ResolvedUploadOptions
  try {
    merged = mergeUploadOptions({}, resolved, {
      ...request,
      expiresAt:
        request.expiresAt !== undefined
          ? request.expiresAt
          : request.expiration !== undefined
            ? undefined
            : resolved.expiresAt,
    })
  } catch (error) {
    throw new UploadError(
      error instanceof Error ? error.message : 'Invalid upload options.'
    )
  }
  return {
    ...merged,
    profileId: resolved.profileId,
    profileRevision: resolved.profileRevision,
    password:
      request.password !== undefined ? request.password : resolved.password,
  }
}

export function uploadErrorResponse(error: unknown): Response {
  if (error instanceof UploadError || error instanceof TagError)
    return Response.json({ error: error.message }, { status: error.status })
  if (error && typeof error === 'object' && 'issues' in error)
    return Response.json({ error: 'Invalid upload options.' }, { status: 400 })
  loggers.files.error(
    'Upload request failed',
    error instanceof Error ? error : new Error('Unknown upload error')
  )
  return Response.json(
    { error: 'Upload could not be completed.' },
    { status: 500 }
  )
}
