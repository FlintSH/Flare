import { z } from 'zod'

import { emailSettingsRoutes } from '@/lib/email/admin'
import {
  getSavedEmailConfig,
  prepareEmailConfig,
  resolveEmailConfig,
} from '@/lib/email/config'
import { emailConfigSchema, validateEnabledEmail } from '@/lib/email/schema'
import {
  describeMailError,
  sendTestEmail,
  verifySmtp,
} from '@/lib/email/transport'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { parseInput, readJson } from '@/lib/http/request'
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
  await requireSession(request, 'settings.email')
  const body = await readJson(request, testSchema)
  const saved = body.config
    ? (
        await prepareEmailConfig(
          parseInput(emailConfigSchema, body.config),
          body.clearPassword
        )
      ).candidate
    : await getSavedEmailConfig()
  const config = resolveEmailConfig(saved, process.env, {
    testDelivery: true,
  }).config
  validateEnabledEmail(config)
  assertEmailEncryptionKey()
  try {
    if (body.action === 'connection') await verifySmtp(config)
    else if (!body.recipient)
      throw new HttpError(400, 'A test recipient is required')
    else await sendTestEmail(config, body.recipient)
  } catch (error) {
    // Flare's own refusals, such as a full daily mail cap, answer as they
    // are; provider errors are described without their details.
    if (error instanceof HttpError) throw error
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
