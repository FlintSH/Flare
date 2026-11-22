import { savePersonalAppearance } from '@/lib/customization/personal'
import {
  personalAppearanceSchema,
  readPersonalAppearance,
} from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/customization/preferences', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  const { session } = await requireSession(request)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  })
  return { data: readPersonalAppearance(user?.preferences) }
})

export const PATCH = api(
  async (request) => {
    const { session } = await requireSession(request, 'appearance.personal')
    const preference = await readJson(request, personalAppearanceSchema, {
      limit: 1024,
    })
    return {
      data: await savePersonalAppearance(session.user.id, preference),
    }
  },
  {
    invalid: () =>
      new HttpError(400, 'Choose inherit, system, light, or dark.'),
    failure: { message: 'Preferences could not be saved.' },
  }
)
