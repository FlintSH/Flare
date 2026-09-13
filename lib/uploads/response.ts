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
})

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
