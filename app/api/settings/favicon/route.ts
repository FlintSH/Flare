import { NextResponse } from 'next/server'

import { join } from 'path'

import { getConfig, updateConfigSection } from '@/lib/config'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function POST(req: Request) {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('appearance.manage')
    if (permissionDenied) return permissionDenied
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return new NextResponse('No file provided', { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // browsers can handle resizing (i think)
    const processedBuffer = buffer

    const storageProvider = await getStorageProvider()
    const faviconPath = join('uploads', 'favicon.png')
    let publicPath = '/api/favicon'

    const config = await getConfig()
    if (config.settings.appearance.favicon) {
      try {
        const oldPath = join('uploads', 'favicon.png')
        await storageProvider.deleteFile(oldPath)
      } catch (error) {
        logger.error('Failed to delete old favicon:', error as Error)
      }
    }

    await storageProvider.uploadFile(processedBuffer, faviconPath, 'image/png')

    const publicUrl = await storageProvider.getPublicUrl(faviconPath)
    if (publicUrl) {
      publicPath = publicUrl
    }

    await updateConfigSection('appearance', { favicon: publicPath })

    return new NextResponse('Favicon updated successfully', { status: 200 })
  } catch (error) {
    logger.error('Error updating favicon:', error as Error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
