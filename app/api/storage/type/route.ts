import { NextResponse } from 'next/server'

import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

export async function GET() {
  try {
    const storageProvider = await getStorageProvider()
    return NextResponse.json({
      type: storageProvider instanceof S3StorageProvider ? 's3' : 'local',
    })
  } catch (error) {
    console.error('Failed to get storage type:', error)
    return NextResponse.json({ type: 'local' })
  }
}
