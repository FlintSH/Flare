import { z } from 'zod'

import { BATCH_LIMIT } from '@/lib/library/contract'
import {
  PLAIN_NAME_MESSAGE,
  isPlainName,
  nameSchema,
} from '@/lib/library/names'

export const FOLDER_NAME_MAX_LENGTH = 80

export const folderNameSchema = z
  .string()
  // Folder names have always refused control characters as typed, so a tab or
  // line break fails here where a tag name turns it into a space.
  .refine(isPlainName, PLAIN_NAME_MESSAGE)
  .pipe(nameSchema('folder', FOLDER_NAME_MAX_LENGTH))
  .refine(
    (name) => !/[\\/]/.test(name) && name !== '.' && name !== '..',
    'Choose a name without slashes; "." and ".." are reserved.'
  )

export const folderIdSchema = z.string().min(1).max(128)

export const folderInputSchema = z
  .object({
    name: folderNameSchema,
    parentId: folderIdSchema.nullable().default(null),
  })
  .strict()

export const folderUpdateSchema = z
  .object({
    name: folderNameSchema.optional(),
    sharing: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.sharing !== undefined,
    'Choose a name or sharing setting to update.'
  )

export const fileFoldersInputSchema = z
  .object({
    fileIds: z.array(folderIdSchema).min(1).max(BATCH_LIMIT),
    folderId: folderIdSchema.nullable(),
  })
  .strict()

export type FolderInput = z.infer<typeof folderInputSchema>
export type FolderUpdate = z.infer<typeof folderUpdateSchema>

export interface FolderView {
  id: string
  name: string
  parentId: string | null
  fileCount: number
  shareToken: string | null
}
