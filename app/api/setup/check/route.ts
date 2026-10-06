import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { checkSetupCompletion } from '@/lib/database/setup'
import { loggers } from '@/lib/logger'

const logger = loggers.startup

async function handleGET() {
  try {
    const completed = await checkSetupCompletion()
    return NextResponse.json({ completed })
  } catch (error) {
    logger.error('Setup check error:', error as Error)
    return NextResponse.json({ completed: false })
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/setup/check',
  })()
}
