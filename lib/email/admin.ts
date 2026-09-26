import { NextResponse } from 'next/server'

import { z } from 'zod'

import { requirePermission } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function emailAdminAccess(request: Request) {
  const auth = await requirePermission('settings.email')
  if (auth.response) return auth.response
  const origin = request.headers.get('origin')
  const allowed = [new URL(request.url).origin]
  if (process.env.NEXTAUTH_URL)
    allowed.push(new URL(process.env.NEXTAUTH_URL).origin)
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    origin &&
    !allowed.includes(origin)
  ) {
    return NextResponse.json(
      { error: 'Invalid request origin' },
      { status: 403 }
    )
  }
  return null
}

export function emailSettingsError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      },
      { status: 400 }
    )
  }
  // SMTP and crypto wrappers expose only sanitized error messages. Prisma
  // errors may include queries, so do not serialize arbitrary exceptions.
  const message =
    error instanceof Error && !('clientVersion' in error)
      ? error.message
      : 'Could not update email settings'
  return NextResponse.json({ error: message }, { status: 400 })
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
