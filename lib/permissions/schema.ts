import { z } from 'zod'

import { ALL_PERMISSIONS, Permission } from './catalog'

const permissionSchema = z.custom<Permission>(
  (value) =>
    typeof value === 'string' && ALL_PERMISSIONS.includes(value as Permission),
  'Unknown permission'
)
export const roleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().max(300).default(''),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color')
      .default('#64748b'),
    position: z.number().int().min(1).max(1000000).default(1),
    permissions: z
      .array(permissionSchema)
      .max(ALL_PERMISSIONS.length)
      .refine(
        (value) => new Set(value).size === value.length,
        'Permissions must be unique'
      )
      .default([]),
  })
  .strict()
export const roleUpdateSchema = roleCreateSchema
  .partial()
  .extend({ position: z.number().int().min(0).max(1000000).optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide a role field to update'
  )
