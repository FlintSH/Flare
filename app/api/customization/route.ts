import { getConfig } from '@/lib/config'
import { appearanceCommandSchema } from '@/lib/customization/schema'
import { saveAppearance } from '@/lib/customization/store'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { hasPermission } from '@/lib/permissions/catalog'

const api = routes('/api/customization', {
  invalid: (error) =>
    new HttpError(
      400,
      error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
    ),
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  const { user } = await requireSession(request)
  const { customization } = (await getConfig()).settings
  return {
    data: hasPermission(user, 'appearance.manage')
      ? customization
      : { published: customization.published },
  }
})

export const POST = api(
  async (request) => {
    await requireSession(request, 'appearance.manage')
    const command = await readJson(request, appearanceCommandSchema, {
      limit: 1_000_000,
    })
    const state = await saveAppearance(command)
    return { data: state }
  },
  {
    failure: {
      message:
        'Appearance could not be saved. Your live appearance is unchanged.',
    },
  }
)
