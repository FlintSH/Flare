import { NextResponse } from 'next/server'

import { z } from 'zod'

import { emailAdminAccess, emailSettingsError } from '@/lib/email/admin'
import {
  getSavedEmailConfig,
  prepareEmailConfig,
  resolveEmailConfig,
} from '@/lib/email/config'
import { assertEmailEncryptionKey } from '@/lib/email/crypto'
import { validateEnabledEmail } from '@/lib/email/schema'
import {
  describeMailError,
  sendTestEmail,
  verifySmtp,
} from '@/lib/email/transport'

const testSchema = z.object({
  action: z.enum(['connection', 'send']),
  recipient: z.string().email().optional(),
  config: z.unknown().optional(),
  clearPassword: z.boolean().optional(),
})

export async function POST(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    const body = testSchema.parse(await request.json())
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
      return NextResponse.json(
        { error: describeMailError(error) },
        { status: 400 }
      )
    }
    return NextResponse.json({
      data: {
        message:
          body.action === 'connection'
            ? 'SMTP connection and authentication succeeded'
            : 'SMTP server accepted the test message. Check your inbox to confirm delivery.',
      },
    })
  } catch (error) {
    return emailSettingsError(error)
  }
}
