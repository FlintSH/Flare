import type { FileFilterOptions } from '@/types/components/file'
import { z } from 'zod'

export const MAX_SAVED_VIEWS = 20
export const MAX_SAVED_VIEW_NAME = 40

const reference = z.string().min(1).max(100).nullable().default(null)
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    'Choose a valid date and time zone.'
  )
  .transform((value) => new Date(value).toISOString())
  .nullable()
  .default(null)
const sortOptions = [
  'newest',
  'oldest',
  'largest',
  'smallest',
  'most-viewed',
  'least-viewed',
  'most-downloaded',
  'least-downloaded',
] as const

export const savedViewFiltersSchema = z
  .object({
    folder: reference,
    tag: reference,
    search: z
      .string()
      .max(500, 'Search must be 500 characters or fewer.')
      .default(''),
    types: z
      .array(
        z
          .string()
          .min(1)
          .max(127)
          .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/, 'Choose a valid file type.')
      )
      .max(50, 'Choose at most 50 file types.')
      .default([])
      .transform((values) => [...new Set(values)].sort()),
    visibility: z
      .array(z.enum(['public', 'private', 'hasPassword']))
      .max(3)
      .default([])
      .transform((values) => [...new Set(values)].sort()),
    dateFrom: timestamp,
    dateTo: timestamp,
    sortBy: z.enum(sortOptions).default('newest'),
    groupBy: z.enum(['none', 'week', 'month', 'year']).default('none'),
  })
  .strict()
  .superRefine((filters, context) => {
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'The end date must be on or after the start date.',
      })
    if (
      filters.groupBy !== 'none' &&
      !['newest', 'oldest'].includes(filters.sortBy)
    )
      context.addIssue({
        code: 'custom',
        path: ['groupBy'],
        message: 'Date grouping requires newest or oldest sorting.',
      })
  })

const name = z
  .string()
  .trim()
  .min(1, 'Enter a view name.')
  .max(MAX_SAVED_VIEW_NAME, 'View names must be 40 characters or fewer.')
const revision = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1)

export const savedViewInputSchema = z
  .object({
    name,
    pinned: z.boolean().default(true),
    filters: savedViewFiltersSchema,
  })
  .strict()

export const savedViewUpdateSchema = z
  .object({
    revision,
    name: name.optional(),
    pinned: z.boolean().optional(),
    filters: savedViewFiltersSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.pinned !== undefined ||
      value.filters !== undefined,
    'Choose a change to save.'
  )

export const savedViewDeleteSchema = z.object({ revision }).strict()

export const storedSavedViewSchema = z
  .object({
    id: z.string().uuid(),
    name,
    pinned: z.boolean(),
    filters: savedViewFiltersSchema,
    revision,
  })
  .strict()

export type SavedViewFilters = z.infer<typeof savedViewFiltersSchema>
export type SavedViewInput = z.infer<typeof savedViewInputSchema>
export type SavedViewUpdate = z.infer<typeof savedViewUpdateSchema>
export type StoredSavedView = z.infer<typeof storedSavedViewSchema>
export type SavedView = StoredSavedView & { unavailableReason: string | null }

/** Pagination belongs to this browser session, never to an account shortcut. */
export function filtersFromLibrary(
  filters: FileFilterOptions
): SavedViewFilters {
  return savedViewFiltersSchema.parse({
    folder: filters.folder ?? null,
    tag: filters.tag ?? null,
    search: filters.search,
    types: filters.types,
    visibility: filters.visibility,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sortBy: filters.sortBy,
    groupBy: filters.groupBy,
  })
}

export function savedViewMatches(
  filters: SavedViewFilters,
  library: FileFilterOptions
): boolean {
  try {
    return (
      JSON.stringify(savedViewFiltersSchema.parse(filters)) ===
      JSON.stringify(filtersFromLibrary(library))
    )
  } catch {
    return false
  }
}
