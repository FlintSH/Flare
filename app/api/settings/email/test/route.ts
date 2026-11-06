import { z } from 'zod'

import { emailSettingsRoutes, requireEmailAdmin } from '@/lib/email/admin'
import {
  getSavedEmailConfig,
  prepareEmailConfig,
  resolveEmailConfig,
} from '@/lib/email/config'
import { validateEnabledEmail } from '@/lib/email/schema'
import {
  describeMailError,
  sendTestEmail,
  verifySmtp,
} from '@/lib/email/transport'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { assertEmailEncryptionKey } from '@/lib/security/secret-box'

const testSchema = z.object({
  action: z.enum(['connection', 'send']),
  recipient: z.string().email().optional(),
  config: z.unknown().optional(),
  clearPassword: z.boolean().optional(),
})

const api = routes('/api/settings/email/test', emailSettingsRoutes)

export const POST = api(async (request) => {
  await requireEmailAdmin(request)
  const body = testSchema.parse(await readJson(request))
  const saved = body.config
    ? (await prepareEmailConfig(body.config, body.clearPassword)).candidate
    : await getSavedEmailConfig()
  const config = resolveEmailConfig(saved, process.env, {
    testDelivery: true,
  }).config
  validateEnabledEmail(config)
  assertEmailEncryptionKey()
  try {
    if (body.action === 'connection') await verifySmtp(config)
    else {
      if (!body.recipient) throw new Error('A test recipient is required')
      await sendTestEmail(config, body.recipient)
    }
  } catch (error) {
    throw new HttpError(400, describeMailError(error))
  }
  return {
    data: {
      message:
        body.action === 'connection'
          ? 'SMTP connection and authentication succeeded'
          : 'SMTP server accepted the test message. Check your inbox to confirm delivery.',
    },
  }
})
