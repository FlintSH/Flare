import { NextResponse } from 'next/server'

import { checkSetupCompletion } from '@/lib/database/setup'
import { loggers } from '@/lib/logger'

const logger = loggers.startup

export async function GET() {
  try {
    const completed = await checkSetupCompletion()
    return NextResponse.json({ completed })
  } catch (error) {
    logger.error('Setup check error:', error as Error)
    return NextResponse.json({ completed: false })
  }
}
