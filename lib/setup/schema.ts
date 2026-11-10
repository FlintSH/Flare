import { z } from 'zod'

import { accountRecordSchema } from '@/lib/auth/e2ee/records'
import { storageSettingsSchema } from '@/lib/storage/settings'
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  accountNameSchema,
  accountPasswordSchema,
} from '@/lib/users/account-policy'

// The rules of every account, worded for the wizard, which shows these
// messages inline. Setup trims the name and address it saves, never the
// password.
export const setupAdminSchema = z.object({
  name: z.string().trim().pipe(accountNameSchema),
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(
      ACCOUNT_PASSWORD_MIN_LENGTH,
      `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters`
    )
    .pipe(accountPasswordSchema),
})

export const setupSchema = z.object({
  admin: setupAdminSchema,
  storage: storageSettingsSchema,
  registrations: z.object({
    enabled: z.boolean(),
    disabledMessage: z.string().optional(),
  }),
})

export type SetupData = z.infer<typeof setupSchema>

/**
 * What `POST /api/setup` reads. The wizard checks its form with
 * `setupSchema`, makes the account record of the administrator from the
 * password field in the browser (docs/e2ee-spec.md, section 5.4), and sends
 * the record in place of the password. Strict: a request that carries the
 * password is refused.
 */
export const setupRequestSchema = z.strictObject({
  admin: z.strictObject({
    name: setupAdminSchema.shape.name,
    email: setupAdminSchema.shape.email,
    account: accountRecordSchema,
  }),
  storage: setupSchema.shape.storage,
  registrations: setupSchema.shape.registrations,
})
