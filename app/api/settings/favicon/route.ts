import { FAVICON_MAX_BYTES } from '@/lib/customization/favicon'
import { saveFavicon } from '@/lib/customization/favicon/server'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import {
  FORM_FRAMING_BYTES,
  assertMediaType,
  assertSameOrigin,
  readForm,
} from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/settings/favicon', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
})

export const POST = api(async (request) => {
  await requireSession('appearance.manage')
  assertSameOrigin(request)
  assertMediaType(request, 'multipart/form-data')

  const form = await readForm(request, {
    limit: FAVICON_MAX_BYTES + FORM_FRAMING_BYTES,
  })
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new HttpError(400, 'No file provided')
  }

  return { url: await saveFavicon(file) }
})
