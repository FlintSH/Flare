import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { validateOwnedTagIds } from '@/lib/tags/service'
import { profileMutationGuard } from '@/lib/uploads/profiles'
import {
  profileError,
  profileSession,
  profileView,
} from '@/lib/uploads/profiles'
import { uploadProfileInputSchema } from '@/lib/uploads/schema'

type Context = { params: Promise<{ id: string }> }
const updateSchema = uploadProfileInputSchema
  .extend({ revision: z.string().datetime() })
  .strict()

export async function PUT(req: Request, { params }: Context) {
  const user = await profileSession()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const guarded = profileMutationGuard(req)
  if (guarded) return guarded
  try {
    const { id } = await params
    const { revision, ...input } = updateSchema.parse(await req.json())
    const profile = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
      if (input.options.tagIds)
        input.options.tagIds = await validateOwnedTagIds(
          user.id,
          input.options.tagIds,
          tx
        )
      const result = await tx.uploadProfile.updateMany({
        where: { id, userId: user.id, updatedAt: new Date(revision) },
        data: input,
      })
      if (!result.count) return null
      return tx.uploadProfile.findUniqueOrThrow({ where: { id } })
    })
    if (!profile)
      return Response.json(
        { error: 'Profile changed or was removed. Reload it before saving.' },
        { status: 409 }
      )
    return Response.json({ data: profileView(profile) })
  } catch (error) {
    return profileError(error)
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const user = await profileSession()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const guarded = profileMutationGuard(req, false)
  if (guarded) return guarded
  try {
    const { id } = await params
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
      await tx.user.updateMany({
        where: { id: user.id, defaultUploadProfileId: id },
        data: { defaultUploadProfileId: null },
      })
      await tx.uploadProfile.deleteMany({ where: { id, userId: user.id } })
    })
    return Response.json({ data: { deleted: true } })
  } catch (error) {
    return profileError(error)
  }
}
