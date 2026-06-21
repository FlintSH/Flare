import { ORGANIZATION_COLORS } from '@/types/dto/folder'
import { z } from 'zod'

export const TAG_NAME_MAX_LENGTH = 40

const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Tag name is required')
  .max(TAG_NAME_MAX_LENGTH, 'Tag name is too long')

const colorSchema = z.enum(ORGANIZATION_COLORS).nullable().optional()

export const CreateTagSchema = z.object({
  name: tagNameSchema,
  color: colorSchema,
})

export type CreateTagRequest = z.infer<typeof CreateTagSchema>

export const UpdateTagSchema = z
  .object({
    name: tagNameSchema.optional(),
    color: colorSchema,
  })
  .refine((data) => data.name !== undefined || data.color !== undefined, {
    message: 'No tag fields provided to update',
  })

export type UpdateTagRequest = z.infer<typeof UpdateTagSchema>

export interface TagDTO {
  id: string
  name: string
  color: string | null
  createdAt: Date
  fileCount: number
}
