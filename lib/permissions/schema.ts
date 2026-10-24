import { z } from 'zod'

import { ALL_PERMISSIONS, Permission } from './catalog'

const permissionSchema = z.custom<Permission>(
  (value) =>
    typeof value === 'string' && ALL_PERMISSIONS.includes(value as Permission),
  'Unknown permission'
)
const roleFields = z
  .object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().max(300),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color'),
    position: z.number().int().min(1).max(1000000),
    permissions: z
      .array(permissionSchema)
      .max(ALL_PERMISSIONS.length)
      .refine(
        (value) => new Set(value).size === value.length,
        'Permissions must be unique'
      ),
  })
  .strict()
export const roleCreateSchema = roleFields.extend({
  description: roleFields.shape.description.default(''),
  color: roleFields.shape.color.default('#64748b'),
  position: roleFields.shape.position.default(1),
  permissions: roleFields.shape.permissions.default([]),
})
// Zod 4 applies defaults inside optional fields, so updates must not inherit
// the create defaults or a partial update would reset omitted fields.
export const roleUpdateSchema = roleFields
  .partial()
  .extend({ position: z.number().int().min(0).max(1000000).optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide a role field to update'
  )
