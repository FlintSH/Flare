import { lockUploadProfiles } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { tagInputSchema } from '@/lib/tags/schema'
import { TagError, tagView, tagViewSelect } from '@/lib/tags/service'
import { removeTagFromProfiles } from '@/lib/uploads/profiles'

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
    await lockUploadProfiles(tx, user.id)
    const removed = await tx.vaultTag.deleteMany({
      where: { id, userId: user.id },
    })
    if (!removed.count) throw new TagError('Tag not found.', 404)
    await removeTagFromProfiles(tx, user.id, id)
  })
  return apiResponse({ deleted: true })
})
