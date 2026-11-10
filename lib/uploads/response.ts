import { z } from 'zod'

const uploadUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value))

const uploadResponseSchema = z.object({
  url: uploadUrl,
  name: z.string().min(1),
  size: z.number().int().nonnegative().finite(),
  type: z.string().min(1),
  pageUrl: uploadUrl.optional(),
  copyText: z.string().optional(),
  /** Set by the browser for a file it encrypted. Its links carry the key after `#`. */
  encrypted: z.boolean().optional(),
})

/**
 * What the server answers for an encrypted upload: no name, no type, and a
 * page address without the key, which the server never has.
 */
const encryptedUploadResponseSchema = z.object({
  encrypted: z.literal(true),
  id: z.string().min(1),
  pageUrl: uploadUrl,
  size: z.number().int().nonnegative().finite(),
})

export function parseEncryptedUploadResponse(value: unknown) {
  const payload =
    typeof value === 'object' && value !== null && 'data' in value
      ? value.data
      : value
  const result = encryptedUploadResponseSchema.safeParse(payload)
  if (!result.success) throw new Error('Could not read the upload response.')
  return result.data
}

export type UploadResponse = z.infer<typeof uploadResponseSchema>

/** Accept both API envelopes and legacy responses before clearing the queue. */
export function parseUploadResponse(value: unknown): UploadResponse {
  const payload =
    typeof value === 'object' && value !== null && 'data' in value
      ? value.data
      : value
  const result = uploadResponseSchema.safeParse(payload)
  if (!result.success) {
    throw new Error('Could not read the upload response.')
  }
  return result.data
}
