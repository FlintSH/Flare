import { readImageUpload } from '@/lib/customization/image-upload'
import { LOGO_POLICY } from '@/lib/customization/logo'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'

const api = routes('/api/customization/assets', {
  failure: { message: 'This image could not be read.' },
})

export const POST = api(async (request) => {
  await requireSession(request, 'appearance.manage')
  const { bytes, type } = await readImageUpload(request, LOGO_POLICY)
  return { data: { url: `data:${type};base64,${bytes.toString('base64')}` } }
})
