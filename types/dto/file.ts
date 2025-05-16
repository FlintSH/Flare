import { z } from 'zod'

/**
 * File DTO Types
 */

// File visibility enum
export enum FileVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// File upload request schema
export const FileUploadSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().default('PUBLIC'),
  password: z.string().optional().nullable(),
})

export type FileUploadRequest = z.infer<typeof FileUploadSchema>

// File metadata response
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
}

// File upload response
export interface FileUploadResponse {
  url: string
  name: string
  size: number
  type: string
}

// File list query parameters schema
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
    .enum(['newest', 'oldest', 'largest', 'smallest', 'name'])
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
})

export type FileListQuery = z.infer<typeof FileListQuerySchema>

// File list response
export interface FileListResponse {
  files: FileMetadata[]
  pagination: {
    total: number
    pageCount: number
    page: number
    limit: number
  }
}

// File types response
export interface FileTypesResponse {
  types: string[]
}
