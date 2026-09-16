import { z } from 'zod'

export const expirationSchema = z.enum([
  'DISABLED',
  'HOUR',
  'DAY',
  'WEEK',
  'MONTH',
])

/** Ignore the retired option in saved profiles, recipes and older clients. */
export function discardLegacyCopyFormat(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value
  const { copyFormat: _copyFormat, ...options } = value as Record<
    string,
    unknown
  >
  return options
}

export const uploadProfileOptionsSchema = z.preprocess(
  discardLegacyCopyFormat,
  z
    .object({
      visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
      expiration: expirationSchema.optional(),
      expiryAction: z.enum(['DELETE', 'SET_PRIVATE']).optional(),
      randomizeFileUrls: z.boolean().optional(),
      shareStyle: z.enum(['minimal', 'framed', 'delivery']).optional(),
    })
    .strict()
)

export type UploadProfileOptions = z.infer<typeof uploadProfileOptionsSchema>
export const uploadProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    options: uploadProfileOptionsSchema,
  })
  .strict()

export const uploadRecipeSchema = z
  .object({
    format: z.literal('flare-upload-profile'),
    version: z.literal(1),
    profile: uploadProfileInputSchema,
  })
  .strict()

export type UploadProfileView = {
  id: string
  name: string
  options: UploadProfileOptions
  updatedAt: string
}

export const uploadRequestOptionsSchema = z.preprocess(
  discardLegacyCopyFormat,
  uploadProfileOptionsSchema
    .innerType()
    .extend({
      profileId: z.string().min(1).max(100).nullable().optional(),
      password: z
        .string()
        .max(72)
        .refine(
          (value) => new TextEncoder().encode(value).length <= 72,
          'Passwords must use at most 72 bytes.'
        )
        .nullable()
        .optional(),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict()
)

export type UploadRequestOptions = z.infer<typeof uploadRequestOptionsSchema>
export type ResolvedUploadOptions = Required<UploadProfileOptions> & {
  profileId: string | null
  profileRevision: string | null
  expiresAt: string | null
  password: string | null
}

export const UPLOAD_DEFAULTS: Required<UploadProfileOptions> = {
  visibility: 'PUBLIC',
  expiration: 'DISABLED',
  expiryAction: 'DELETE',
  randomizeFileUrls: false,
  shareStyle: 'framed',
}

/** Omission inherits; DISABLED explicitly turns expiration off. Durations use UTC. */
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

/** Pure precedence contract shared by transport adapters and contract tests. */
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
    throw new Error('Expiration must be in the future.')
  return {
    ...merged,
    profileId: request.profileId ?? null,
    profileRevision: null,
    password: request.password || null,
    expiresAt,
  }
}
