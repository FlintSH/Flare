import { z } from 'zod'

export const folderNameSchema = z
  .string()
  .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), 'Use a plain-text name.')
  .transform((name) => name.normalize('NFKC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Give your folder a name.')
      .max(80, 'Folder names can be up to 80 characters.')
      .refine(
        (name) => !/[\\/]/.test(name) && name !== '.' && name !== '..',
        'Choose a name without slashes; "." and ".." are reserved.'
      )
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
    fileIds: z.array(folderIdSchema).min(1).max(100),
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
