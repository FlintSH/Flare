import { z } from 'zod'

// A small, theme-friendly palette of accent colors that folders and tags can
// use. Kept as a closed set so the UI can render consistent swatches and we can
// validate input server-side.
export const ORGANIZATION_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const

export type OrganizationColor = (typeof ORGANIZATION_COLORS)[number]

export const FOLDER_NAME_MAX_LENGTH = 60

const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Folder name is required')
  .max(FOLDER_NAME_MAX_LENGTH, 'Folder name is too long')

const colorSchema = z.enum(ORGANIZATION_COLORS).nullable().optional()

export const CreateFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().cuid().nullable().optional(),
  color: colorSchema,
})

export type CreateFolderRequest = z.infer<typeof CreateFolderSchema>

export const UpdateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    // `null` moves the folder to the root level.
    parentId: z.string().cuid().nullable().optional(),
    color: colorSchema,
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.parentId !== undefined ||
      data.color !== undefined,
    { message: 'No folder fields provided to update' }
  )

export type UpdateFolderRequest = z.infer<typeof UpdateFolderSchema>

export interface FolderDTO {
  id: string
  name: string
  color: string | null
  parentId: string | null
  createdAt: Date
  updatedAt: Date
  fileCount: number
}

export interface FolderTreeNode extends FolderDTO {
  children: FolderTreeNode[]
  // Total files in this folder and all descendants.
  totalFileCount: number
}

export interface FolderBreadcrumbItem {
  id: string
  name: string
}
