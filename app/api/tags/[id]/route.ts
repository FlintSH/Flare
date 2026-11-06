import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { tagInputSchema } from '@/lib/tags/schema'
import { TagError, tagView, tagViewSelect } from '@/lib/tags/service'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/tags/[id]', tagRoutes)

export const PATCH = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const { id } = await params
  const input = tagInputSchema.parse(await readJson(request))
  const tag = await prisma.vaultTag.update({
    where: { id, userId: user.id },
    data: { ...input, normalizedName: input.name.toLowerCase() },
    select: tagViewSelect,
  })
  return apiResponse(tagView(tag))
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  assertJsonMutation(request, { body: false })
  const { id } = await params
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, user.id)
    const removed = await tx.vaultTag.deleteMany({
      where: { id, userId: user.id },
    })
    if (!removed.count) throw new TagError('Tag not found.', 404)
    // Profile defaults are local references; removing a tag must leave those
    // profiles usable. Preserve every unrelated profile option.
    const profiles = await tx.uploadProfile.findMany({
      where: { userId: user.id },
      select: { id: true, options: true },
    })
    for (const profile of profiles) {
      const options = profile.options
      if (!options || typeof options !== 'object' || Array.isArray(options))
        continue
      if (!Array.isArray(options.tagIds) || !options.tagIds.includes(id))
        continue
      await tx.uploadProfile.update({
        where: { id: profile.id },
        data: {
          options: {
            ...options,
            tagIds: options.tagIds.filter((tagId) => tagId !== id),
          },
        },
      })
    }
  })
  return apiResponse({ deleted: true })
})
