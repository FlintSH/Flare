import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const logger = loggers.api

export async function GET() {
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
