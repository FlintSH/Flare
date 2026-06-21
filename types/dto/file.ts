import { z } from 'zod'

export enum FileVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export const FileUploadSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().default('PUBLIC'),
  password: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
})

export type FileUploadRequest = z.infer<typeof FileUploadSchema>

export const FileUploadFormDataSchema = z.object({
  file: z.instanceof(File, { message: 'No file provided' }),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  password: z.string().optional().nullable(),
})

export type FileUploadFormData = z.infer<typeof FileUploadFormDataSchema>

export interface FileTagSummary {
  id: string
  name: string
  color: string | null
}

export interface FileFolderSummary {
  id: string
  name: string
}

export interface FileMetadata {
  id: string
  name: string
  urlPath: string
  mimeType: string
  size: number
  uploadedAt: Date
  visibility: string
  views: number
  downloads: number
  hasPassword: boolean
  expiresAt?: Date | null
  folderId: string | null
  folder: FileFolderSummary | null
  tags: FileTagSummary[]
}

export interface FileUploadResponse {
  url: string
  name: string
  size: number
  type: string
}

export const FileListQuerySchema = z.object({
  page: z
    .string()
    .transform((val) => parseInt(val) || 1)
    .optional(),
  limit: z
    .string()
    .transform((val) => parseInt(val) || 24)
    .optional(),
  search: z.string().optional(),
  sortBy: z
    .enum([
      'newest',
      'oldest',
      'largest',
      'smallest',
      'most-viewed',
      'least-viewed',
      'most-downloaded',
      'least-downloaded',
      'name-asc',
      'name-desc',
      'name',
    ])
    .optional(),
  types: z
    .string()
    .transform((val) => val.split(','))
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  visibility: z
    .string()
    .transform((val) => val.split(','))
    .optional(),
  // `folderId` may be a folder id, the literal 'none' (unfiled files only), or
  // absent (files across all folders).
  folderId: z.string().optional(),
  tags: z
    .string()
    .transform((val) => val.split(','))
    .optional(),
})

export type FileListQuery = z.infer<typeof FileListQuerySchema>

export const BulkFileActionSchema = z
  .object({
    fileIds: z.array(z.string().cuid()).min(1, 'No files selected'),
    action: z.enum(['move', 'addTags', 'removeTags', 'delete']),
    folderId: z.string().nullable().optional(),
    tagIds: z.array(z.string().cuid()).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.action === 'addTags' || data.action === 'removeTags') &&
      (!data.tagIds || data.tagIds.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tagIds is required for tag actions',
        path: ['tagIds'],
      })
    }
  })

export type BulkFileActionRequest = z.infer<typeof BulkFileActionSchema>

export const UpdateFileSchema = z
  .object({
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    password: z.string().nullable().optional(),
    // `null` removes the file from any folder.
    folderId: z.string().nullable().optional(),
    // Full replacement of the file's tags when provided.
    tagIds: z.array(z.string().cuid()).optional(),
  })
  .refine(
    (data) =>
      data.visibility !== undefined ||
      data.password !== undefined ||
      data.folderId !== undefined ||
      data.tagIds !== undefined,
    { message: 'No file fields provided to update' }
  )

export type UpdateFileRequest = z.infer<typeof UpdateFileSchema>

export interface FileListResponse {
  files: FileMetadata[]
  pagination: {
    total: number
    pageCount: number
    page: number
    limit: number
  }
}

export interface FileTypesResponse {
  types: string[]
}
