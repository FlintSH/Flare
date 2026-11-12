import type { InputJsonValue } from '@prisma/client/runtime/library'

import { getConfig } from '@/lib/config'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { personalEmbedSchema, readPersonalEmbed } from '@/lib/embeds/schema'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
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
  const { sharing } = (await getConfig()).settings.customization.published
  if (!sharing.personalEmbeds)
    throw new HttpError(403, 'This instance uses one embed for every account.')
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, session.user.id)
    const user = await tx.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { preferences: true },
    })
    const previous =
      user.preferences &&
      typeof user.preferences === 'object' &&
      !Array.isArray(user.preferences)
        ? user.preferences
        : {}
    await tx.user.update({
      where: { id: session.user.id },
      data: { preferences: { ...previous, embed } as InputJsonValue },
    })
  })
  return { data: embed }
})
