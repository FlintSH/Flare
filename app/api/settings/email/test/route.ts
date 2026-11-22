import { z } from 'zod'

import {
  emailSettingsRoutes,
  testEmailSettings,
  testSavedEmailSettings,
} from '@/lib/email/admin'
import { prepareEmailConfig } from '@/lib/email/config'
import { emailConfigSchema } from '@/lib/email/schema'
import { requireSession } from '@/lib/http/access'
import { parseInput, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'

const testSchema = z.object({
  action: z.enum(['connection', 'send']),
  recipient: z.string().email().optional(),
  config: z.unknown().optional(),
  clearPassword: z.boolean().optional(),
})

const api = routes('/api/settings/email/test', emailSettingsRoutes)

export const POST = api(async (request) => {
  await requireSession(request, ADMIN_PERMISSIONS.manageEmailSettings)
  const body = await readJson(request, testSchema)
  // The form can test what it shows before saving it.
  const message = body.config
    ? await testEmailSettings(
        (
          await prepareEmailConfig(
            parseInput(emailConfigSchema, body.config),
            body.clearPassword
          )
        ).candidate,
        body
      )
    : await testSavedEmailSettings(body)
  return { data: { message } }
})
