import { z } from 'zod'

import { nameTemplateProblem } from '@/lib/files/name-template'
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

/** A pattern for new URL names, such as `shot-{date}-{random:4}`. */
export const nameTemplateSchema = z.string().superRefine((value, ctx) => {
  const problem = nameTemplateProblem(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

/**
 * Fields this version doesn't know, such as the retired copy format, are left
 * out; a known field with a bad value is not.
 */
export const uploadProfileOptionsSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  expiration: expirationSchema.optional(),
  expiryAction: z.enum(['DELETE', 'SET_PRIVATE']).optional(),
  randomizeFileUrls: z.boolean().optional(),
  nameTemplate: nameTemplateSchema.optional(),
  shareStyle: z.enum(['minimal', 'framed', 'delivery']).optional(),
  tagIds: z.array(z.string().min(1).max(100)).max(PROFILE_TAG_LIMIT).optional(),
})

export type UploadProfileOptions = z.infer<typeof uploadProfileOptionsSchema>

/**
 * Naming is one choice written with two options. The most specific layer that
 * names a strategy decides it whole: a pattern replaces original or random
 * names, and a layer that only sets `randomizeFileUrls` drops a pattern it
 * would have inherited.
 */
export function namingChoice(layer: {
  randomizeFileUrls?: boolean
  nameTemplate?: string | null
}): { randomizeFileUrls?: boolean; nameTemplate?: string | null } {
  if (layer.nameTemplate != null)
    return { randomizeFileUrls: false, nameTemplate: layer.nameTemplate }
  if (layer.randomizeFileUrls !== undefined)
    return { randomizeFileUrls: layer.randomizeFileUrls, nameTemplate: null }
  return {}
}

/**
 * Any other field is refused, except the retired copy format: older clients
 * and recipes still send it, and requests ignore it.
 */
export function requestFields<Shape extends z.ZodRawShape>(shape: Shape) {
  const fields = z.strictObject(shape)
  return fields
    .extend({ copyFormat: z.unknown().optional() })
    .refine(
      (value) => {
        const naming = value as {
          randomizeFileUrls?: unknown
          nameTemplate?: unknown
        }
        return (
          naming.nameTemplate === undefined || naming.randomizeFileUrls !== true
        )
      },
      {
        path: ['nameTemplate'],
        message: 'Choose a name pattern or random names, not both.',
      }
    )
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
/** Every profile option decided. No pattern is `null`, not an absent field. */
export type EffectiveUploadOptions = Required<
  Omit<UploadProfileOptions, 'nameTemplate'>
> & { nameTemplate: string | null }
export type ResolvedUploadOptions = EffectiveUploadOptions & {
  profileId: string | null
  /** Request-only destination; older in-flight uploads may omit it. */
  folderId?: string | null
  profileRevision: string | null
  /** Internal snapshot of reviewed effective settings, including inherited defaults. */
  profileEffectiveRevision?: string | null
  expiresAt: string | null
  password: string | null
}

export const UPLOAD_DEFAULTS: EffectiveUploadOptions = {
  visibility: 'PUBLIC',
  expiration: 'DISABLED',
  expiryAction: 'DELETE',
  randomizeFileUrls: false,
  nameTemplate: null,
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

/** Account defaults under a profile's choices, as a summary or a hash reads them. */
export function effectiveUploadOptions(
  account: UploadProfileOptions = {},
  profile: UploadProfileOptions = {}
): EffectiveUploadOptions {
  return {
    ...UPLOAD_DEFAULTS,
    ...account,
    ...namingChoice(account),
    ...profile,
    ...namingChoice(profile),
  }
}

export function mergeUploadOptions(
  account: UploadProfileOptions,
  // A resolved upload is merged again when its chunks complete.
  profile: UploadProfileOptions | ResolvedUploadOptions,
  request: UploadRequestOptions,
  now = new Date()
): ResolvedUploadOptions {
  // In-flight chunk uploads may still carry the retired field in their snapshot.
  const { copyFormat: _copyFormat, ...merged } = {
    copyFormat: undefined,
    ...UPLOAD_DEFAULTS,
    ...account,
    ...namingChoice(account),
    ...profile,
    ...namingChoice(profile),
    ...request,
    ...namingChoice(request),
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
