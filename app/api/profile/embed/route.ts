import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { savePersonalEmbed } from '@/lib/embeds/personal'
import { personalEmbedSchema, readPersonalEmbed } from '@/lib/embeds/schema'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/profile/embed', {
  failure: { message: 'Embed settings could not be saved.' },
})

/** How the signed-in account's links preview, and whether it may choose. */
export const GET = api(async (request) => {
  const { session } = await requireSession(request)
  const [user, config] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
    getConfig(),
  ])
  return {
    data: readPersonalEmbed(user?.preferences),
    allowed: config.settings.customization.published.sharing.personalEmbeds,
  }
})

export const PATCH = api(async (request) => {
  const { session } = await requireSession(request, 'files.share')
  const embed = await readJson(request, personalEmbedSchema, { limit: 4096 })
  return { data: await savePersonalEmbed(session.user.id, embed) }
})
