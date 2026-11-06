import { z } from 'zod'

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
