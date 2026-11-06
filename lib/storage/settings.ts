import { z } from 'zod'

// The setup wizard checks its form with this schema, so it must stay
// importable in the browser.

const REQUIRED_S3_FIELDS = {
  bucket: 'Bucket name is required',
  region: 'Region is required',
  accessKeyId: 'Access key ID is required',
  secretAccessKey: 'Secret access key is required',
} as const

function isHttpUrl(value: string) {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * Storage settings Flare can store files with. Setup and every settings save
 * that submits storage check them, and no provider is built from settings
 * that fail.
 */
export const storageSettingsSchema = z
  .object({
    provider: z.enum(['local', 's3']),
    s3: z.object({
      bucket: z.string().trim(),
      region: z.string().trim(),
      accessKeyId: z.string().trim(),
      // Secret values are opaque; never change their bytes while validating.
      secretAccessKey: z.string(),
      endpoint: z.string().trim().optional(),
      forcePathStyle: z.boolean().default(false),
    }),
  })
  .superRefine((storage, context) => {
    // Hidden S3 details must not block a switch back to local storage.
    if (storage.provider !== 's3') return
    for (const [field, message] of Object.entries(REQUIRED_S3_FIELDS))
      if (!storage.s3[field as keyof typeof REQUIRED_S3_FIELDS].trim())
        context.addIssue({ code: 'custom', path: ['s3', field], message })
    if (storage.s3.endpoint && !isHttpUrl(storage.s3.endpoint))
      context.addIssue({
        code: 'custom',
        path: ['s3', 'endpoint'],
        message: 'Enter a valid HTTP or HTTPS endpoint URL',
      })
  })
