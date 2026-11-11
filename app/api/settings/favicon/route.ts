import { FAVICON_POLICY } from '@/lib/customization/favicon'
import { removeFavicon, saveFavicon } from '@/lib/customization/favicon/server'
import { readImageUpload } from '@/lib/customization/image-upload'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/settings/favicon', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
})

export const POST = api(async (request) => {
  await requireSession(request, 'appearance.manage')
  const { bytes } = await readImageUpload(request, FAVICON_POLICY)
  return { url: await saveFavicon(bytes) }
})

export const DELETE = api(async (request) => {
  await requireSession(request, 'appearance.manage')
  await removeFavicon()
  return { url: null }
})
