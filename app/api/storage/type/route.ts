import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.storage

export async function GET() {
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
