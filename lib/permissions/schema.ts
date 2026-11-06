import { z } from 'zod'

import { ALL_PERMISSIONS, Permission } from './catalog'
import { EVERYONE_POSITION, ROLE_DEFAULTS, ROLE_LIMITS } from './policy'

const permissionSchema = z.custom<Permission>(
  (value) =>
    typeof value === 'string' && ALL_PERMISSIONS.includes(value as Permission),
  'Unknown permission'
)
const roleFields = z
  .object({
    name: z.string().trim().min(1).max(ROLE_LIMITS.name),
    description: z.string().trim().max(ROLE_LIMITS.description),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color'),
    position: z
      .number()
      .int()
      .min(ROLE_LIMITS.position.min)
      .max(ROLE_LIMITS.position.max),
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
  description: roleFields.shape.description.default(ROLE_DEFAULTS.description),
  color: roleFields.shape.color.default(ROLE_DEFAULTS.color),
  position: roleFields.shape.position.default(ROLE_DEFAULTS.position),
  permissions: roleFields.shape.permissions.default([]),
})
// Zod 4 applies defaults inside optional fields, so updates must not inherit
// the create defaults or a partial update would reset omitted fields.
// Everyone's own position passes here; the role service refuses it for any
// other role with its own message.
export const roleUpdateSchema = roleFields
  .partial()
  .extend({
    position: z
      .number()
      .int()
      .min(EVERYONE_POSITION)
      .max(ROLE_LIMITS.position.max)
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide a role field to update'
  )
