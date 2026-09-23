import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { tagInputSchema } from '@/lib/tags/schema'
import { TagError, tagView, tagViewSelect } from '@/lib/tags/service'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = tagMutationGuard(request)
    if (guarded) return guarded
    const { id } = await params
    const input = tagInputSchema.parse(await request.json())
    const tag = await prisma.vaultTag.update({
      where: { id, userId: user.id },
      data: { ...input, normalizedName: input.name.toLowerCase() },
      select: tagViewSelect,
    })
    return apiResponse(tagView(tag))
  } catch (error) {
    return tagErrorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = tagMutationGuard(request, false)
    if (guarded) return guarded
    const { id } = await params
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
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
  } catch (error) {
    return tagErrorResponse(error)
  }
}
