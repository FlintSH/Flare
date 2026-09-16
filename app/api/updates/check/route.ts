import { NextResponse } from 'next/server'

import { getAccessSession } from '@/lib/auth'
import { loggers } from '@/lib/logger'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const logger = loggers.api

export async function GET() {
  try {
    const session = await getAccessSession()
    if (!session?.user || session.user.role !== 'ADMIN') {
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
