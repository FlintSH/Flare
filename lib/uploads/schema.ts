import { z } from 'zod'

import { newFilePasswordSchema } from '@/lib/files/password-policy'
import { HttpError } from '@/lib/http/errors'
import { isoDateTimeWithOffset } from '@/lib/utils/iso-datetime'

export const expirationSchema = z.enum([
  'DISABLED',
  'HOUR',
  'DAY',
  'WEEK',
  'MONTH',
])

export const PROFILE_NAME_MAX_LENGTH = 80
/** The most tags a profile, or one upload, can select. */
export const PROFILE_TAG_LIMIT = 20

/**
 * Fields this version doesn't know, such as the retired copy format, are left
 * out; a known field with a bad value is not.
 */
export const uploadProfileOptionsSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  expiration: expirationSchema.optional(),
  expiryAction: z.enum(['DELETE', 'SET_PRIVATE']).optional(),
  randomizeFileUrls: z.boolean().optional(),
  shareStyle: z.enum(['minimal', 'framed', 'delivery']).optional(),
  tagIds: z.array(z.string().min(1).max(100)).max(PROFILE_TAG_LIMIT).optional(),
})

export type UploadProfileOptions = z.infer<typeof uploadProfileOptionsSchema>

/**
 * Any other field is refused, except the retired copy format: older clients
 * and recipes still send it, and requests ignore it.
 */
export function requestFields<Shape extends z.ZodRawShape>(shape: Shape) {
  const fields = z.strictObject(shape)
  return fields
    .extend({ copyFormat: z.unknown().optional() })
    .transform((value) => {
      const { copyFormat: _retired, ...sent } = value as {
        copyFormat?: unknown
      }
      return sent as z.output<typeof fields>
    })
}

export const uploadProfileInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(PROFILE_NAME_MAX_LENGTH),
  options: requestFields(uploadProfileOptionsSchema.shape),
})
export type UploadProfileInput = z.infer<typeof uploadProfileInputSchema>

/** The largest recipe file the importer reads, and the largest create request. */
export const RECIPE_MAX_BYTES = 64 * 1024

export const uploadRecipeSchema = z
  .object({
    format: z.literal('flare-upload-profile'),
    version: z.literal(1),
    profile: uploadProfileInputSchema,
  })
  .strict()
export type UploadRecipe = z.infer<typeof uploadRecipeSchema>

export function uploadRecipe({
  name,
  options,
}: UploadProfileInput): UploadRecipe {
  return {
    format: 'flare-upload-profile',
    version: 1,
    profile: { name, options },
  }
}

export function newProfileSchema(body: unknown): z.ZodType<UploadProfileInput> {
  const recipe =
    typeof body === 'object' && body !== null && 'format' in body && body.format
  return recipe
    ? uploadRecipeSchema.transform((recipe) => recipe.profile)
    : uploadProfileInputSchema
}

export type UploadProfileView = {
  id: string
  name: string
  options: UploadProfileOptions
  updatedAt: string
}

export const uploadRequestOptionFields = {
  ...uploadProfileOptionsSchema.shape,
  profileId: z.string().min(1).max(100).nullable().optional(),
  folderId: z.string().min(1).max(128).nullable().optional(),
  password: newFilePasswordSchema.nullable().optional(),
  expiresAt: isoDateTimeWithOffset.nullable().optional(),
}

export const uploadRequestOptionsSchema = requestFields(
  uploadRequestOptionFields
)

export type UploadRequestOptions = z.infer<typeof uploadRequestOptionsSchema>
export type ResolvedUploadOptions = Required<UploadProfileOptions> & {
  profileId: string | null
  /** Request-only destination; older in-flight uploads may omit it. */
  folderId?: string | null
  profileRevision: string | null
  /** Internal snapshot of reviewed effective settings, including inherited defaults. */
  profileEffectiveRevision?: string | null
  expiresAt: string | null
  password: string | null
}

export const UPLOAD_DEFAULTS: Required<UploadProfileOptions> = {
  visibility: 'PUBLIC',
  expiration: 'DISABLED',
  expiryAction: 'DELETE',
  randomizeFileUrls: false,
  shareStyle: 'framed',
  tagIds: [],
}

export function expirationDate(
  expiration: Required<UploadProfileOptions>['expiration'],
  now: Date
): string | null {
  if (expiration === 'DISABLED') return null
  const date = new Date(now)
  if (expiration === 'MONTH') date.setUTCMonth(date.getUTCMonth() + 1)
  else
    date.setTime(
      date.getTime() + { HOUR: 1, DAY: 24, WEEK: 168 }[expiration] * 3_600_000
    )
  return date.toISOString()
}

export function mergeUploadOptions(
  account: UploadProfileOptions,
  profile: UploadProfileOptions,
  request: UploadRequestOptions,
  now = new Date()
): ResolvedUploadOptions {
  // In-flight chunk uploads may still carry the retired field in their snapshot.
  const { copyFormat: _copyFormat, ...merged } = {
    copyFormat: undefined,
    ...UPLOAD_DEFAULTS,
    ...account,
    ...profile,
    ...request,
  }
  const expiresAt =
    request.expiresAt !== undefined
      ? request.expiresAt
      : expirationDate(merged.expiration, now)
  if (expiresAt && new Date(expiresAt) <= now)
    throw new HttpError(400, 'Expiration must be in the future.')
  return {
    ...merged,
    profileId: request.profileId ?? null,
    folderId: request.folderId ?? null,
    profileRevision: null,
    password: request.password || null,
    expiresAt,
  }
}
