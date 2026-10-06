import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.storage

async function handleGET() {
  try {
    const storageProvider = await getStorageProvider()
    return NextResponse.json({
      type: storageProvider.kind,
    })
  } catch (error) {
    logger.error('Failed to get storage type:', error as Error)
    return NextResponse.json({ type: 'local' })
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/storage/type',
  })()
}
