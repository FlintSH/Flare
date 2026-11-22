import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { parseInput, readJson } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'
import { assertEmailEncryptionKey } from '@/lib/security/secret-box'

import { getSavedEmailConfig, resolveEmailConfig } from './config'
import { hasVerifiedEmail, satisfiesEmailPolicy } from './policy'
import {
  type EmailConfig,
  emailConfigSchema,
  validateEnabledEmail,
} from './schema'
import { describeMailError, sendTestEmail, verifySmtp } from './transport'

export const emailSettingsRoutes: RouteContract = {
  invalid: (error) =>
    new HttpError(
      400,
      error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
    ),
  failure: { message: 'Could not update email settings' },
}

const draftBody = z.object({
  config: z.unknown().optional(),
  clearPassword: z.unknown().optional(),
  applyToExisting: z.unknown().optional(),
})

export async function readEmailDraft(request: Request) {
  const body = await readJson(request, draftBody)
  return {
    config: parseInput(emailConfigSchema, body.config),
    clearPassword: body.clearPassword === true,
    applyToExisting: body.applyToExisting === true,
  }
}

export async function emailDiagnostics(enabled: boolean) {
  const [groups, recent] = await Promise.all([
    prisma.mailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.mailOutbox.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        purpose: true,
        recipient: true,
        status: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
        lastError: true,
      },
    }),
  ])
  const counts = { pending: 0, processing: 0, sent: 0, failed: 0 }
  for (const group of groups)
    if (group.status in counts)
      counts[group.status as keyof typeof counts] = group._count._all
  return {
    state: !enabled
      ? 'disabled'
      : counts.failed
        ? 'degraded'
        : counts.sent
          ? 'working'
          : 'configured',
    counts,
    recent: recent.map((row) => ({
      ...row,
      recipient: row.recipient.replace(/^(.).*(@.*)$/, '$1***$2'),
    })),
  }
}

/** How many accounts an email policy leaves unverified, and how many it shuts out. */
export async function emailPolicyImpact(config: EmailConfig) {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      emailVerifiedFor: true,
      emailVerified: true,
      emailVerificationSource: true,
      emailExempt: true,
    },
  })
  const unverified = users.filter((user) => !hasVerifiedEmail(user, config))
  // The accounts all-user verification shuts out once its grace period ends.
  const affected = users.filter((user) => !satisfiesEmailPolicy(user, config))
  return {
    unverifiedUsers: unverified.length,
    affectedUsers: affected.length,
  }
}

/** Check the SMTP connection, or send one test message to a recipient. */
export interface EmailTest {
  action: 'connection' | 'send'
  recipient?: string
}

/**
 * Tests delivery with email settings as they are stored, with an encrypted
 * password: the saved ones, or a draft `prepareEmailConfig` made. Answers
 * the message to show.
 */
export async function testEmailSettings(
  settings: EmailConfig,
  test: EmailTest
): Promise<string> {
  const config = resolveEmailConfig(settings, process.env, {
    testDelivery: true,
  }).config
  validateEnabledEmail(config)
  assertEmailEncryptionKey()
  try {
    if (test.action === 'connection') await verifySmtp(config)
    else if (!test.recipient)
      throw new HttpError(400, 'A test recipient is required')
    else await sendTestEmail(config, test.recipient)
  } catch (error) {
    // Flare's own refusals, such as a full daily mail cap, answer as they
    // are; provider errors are described without their details.
    if (error instanceof HttpError) throw error
    throw new HttpError(400, describeMailError(error))
  }
  return test.action === 'connection'
    ? 'SMTP connection and authentication succeeded'
    : 'SMTP server accepted the test message. Check your inbox to confirm delivery.'
}

/** Tests delivery with the saved email settings and nothing else. */
export async function testSavedEmailSettings(test: EmailTest) {
  return testEmailSettings(await getSavedEmailConfig(), test)
}
