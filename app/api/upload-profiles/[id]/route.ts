import { z } from 'zod'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { validateOwnedTagIds } from '@/lib/tags/service'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { profileView } from '@/lib/uploads/profiles'
import { uploadProfileInputSchema } from '@/lib/uploads/schema'

type Context = { params: Promise<{ id: string }> }
const updateSchema = uploadProfileInputSchema
  .extend({ revision: z.string().datetime() })
  .strict()

const api = routes('/api/upload-profiles/[id]', uploadProfileRoutes)

export const PUT = api(async (request, { params }: Context) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request)
  const { id } = await params
  const { revision, ...input } = updateSchema.parse(await readJson(request))
  const profile = await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, user.id)
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
    throw new HttpError(
      409,
      'Profile changed or was removed. Reload it before saving.'
    )
  return Response.json({ data: profileView(profile) })
})

export const DELETE = api(async (request, { params }: Context) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request, { body: false })
  const { id } = await params
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, user.id)
    await tx.user.updateMany({
      where: { id: user.id, defaultUploadProfileId: id },
      data: { defaultUploadProfileId: null },
    })
    await tx.uploadProfile.deleteMany({ where: { id, userId: user.id } })
  })
  return Response.json({ data: { deleted: true } })
})
