import { ZodError } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertSameOrigin } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'

/** Email settings need settings.email; their writes must come from this app. */
export async function requireEmailAdmin(request: Request) {
  const access = await requireSession('settings.email')
  if (!['GET', 'HEAD'].includes(request.method)) assertSameOrigin(request)
  return access
}

export const emailSettingsRoutes: RouteContract = {
  invalid: (error) =>
    new HttpError(
      400,
      error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
    ),
  // SMTP and crypto wrappers expose only sanitized error messages. Prisma
  // errors may include queries, so do not serialize them.
  translate: (error) =>
    error instanceof Error &&
    !(error instanceof HttpError) &&
    !(error instanceof ZodError) &&
    !('clientVersion' in error)
      ? new HttpError(400, error.message)
      : undefined,
  failure: { status: 400, message: 'Could not update email settings' },
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
