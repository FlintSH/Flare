import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const logger = loggers.api

async function handleGET() {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('settings.read')
    if (permissionDenied) return permissionDenied
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return NextResponse.json(await checkForUpdates(getBuildInfo()))
  } catch (error) {
    logger.error('Update check error:', error as Error)
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/updates/check',
  })()
}
