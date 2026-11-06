import { NextResponse } from 'next/server'

import { join } from 'path'

import { getConfig, updateConfig } from '@/lib/config'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

const api = routes('/api/settings/favicon', {
  failure: { message: 'Internal server error' },
  logger,
})

export const POST = api(async (request) => {
  await requireSession('appearance.manage')

  const formData = await request.formData()
  const file = formData.get('file') as File
  if (!file) {
    throw new HttpError(400, 'No file provided')
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

  await updateConfig({ settings: { appearance: { favicon: publicPath } } })

  return new NextResponse('Favicon updated successfully', { status: 200 })
})
