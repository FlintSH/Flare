import { fileTypeFromBuffer } from 'file-type'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertMediaType, assertSameOrigin, readForm } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/customization/assets', {
  failure: { status: 400, message: 'This image could not be read.' },
})

export const POST = api(async (request) => {
  await requireSession('appearance.manage')
  assertSameOrigin(request)
  assertMediaType(request, 'multipart/form-data')
  const data = await readForm(request, {
    limit: 300_000,
    tooLarge: 'Logos must be smaller than 256 KB.',
  })
  const file = data.get('file')
  if (!(file instanceof File) || file.size > 256 * 1024)
    throw new HttpError(
      400,
      'Choose a PNG, JPEG, or WebP logo smaller than 256 KB.'
    )
  const buffer = Buffer.from(await file.arrayBuffer())
  const type = await fileTypeFromBuffer(buffer)
  if (!type || !['image/png', 'image/jpeg', 'image/webp'].includes(type.mime))
    throw new HttpError(400, 'Only PNG, JPEG, and WebP images are supported.')
  return {
    data: {
      url: `data:${type.mime};base64,${buffer.toString('base64')}`,
    },
  }
})
