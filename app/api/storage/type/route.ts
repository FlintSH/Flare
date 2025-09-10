import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

const logger = loggers.storage

export async function GET() {
  try {
    const storageProvider = await getStorageProvider()
    return NextResponse.json({
      type: storageProvider instanceof S3StorageProvider ? 's3' : 'local',
    })
  } catch (error) {
    logger.error('Failed to get storage type:', error as Error)
    return NextResponse.json({ type: 'local' })
  }
}
