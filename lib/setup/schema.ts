import { z } from 'zod'

export const setupAdminSchema = z.object({
  name: z.string().trim().min(1, 'Username is required'),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const setupStorageSchema = z
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
    if (storage.provider !== 's3') return
    const required = {
      bucket: 'Bucket name is required',
      region: 'Region is required',
      accessKeyId: 'Access key ID is required',
      secretAccessKey: 'Secret access key is required',
    } as const
    for (const [field, message] of Object.entries(required)) {
      if (!storage.s3[field as keyof typeof required].trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['s3', field],
          message,
        })
      }
    }
    // Hidden S3 details must not block a switch back to local storage.
    if (storage.s3.endpoint) {
      let validEndpoint = false
      try {
        validEndpoint = ['https:', 'http:'].includes(
          new URL(storage.s3.endpoint).protocol
        )
      } catch {
        validEndpoint = false
      }
      if (!validEndpoint) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['s3', 'endpoint'],
          message: 'Enter a valid HTTP or HTTPS endpoint URL',
        })
      }
    }
  })

export const setupSchema = z.object({
  admin: setupAdminSchema,
  storage: setupStorageSchema,
  registrations: z.object({
    enabled: z.boolean(),
    disabledMessage: z.string().optional(),
  }),
})

export type SetupData = z.infer<typeof setupSchema>
