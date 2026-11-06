import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { parseInput, readJson } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'

import { emailConfigSchema } from './schema'

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
