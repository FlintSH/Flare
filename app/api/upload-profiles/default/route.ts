import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { requirePermission } from '@/lib/permissions/server'
import { profileMutationGuard } from '@/lib/uploads/profiles'
import { profileError } from '@/lib/uploads/profiles'

export async function PUT(req: Request) {
  const { user, response } = await requirePermission('uploadProfiles.manage')
  if (response) return response
  const guarded = profileMutationGuard(req)
  if (guarded) return guarded
  try {
    const { profileId } = z
      .object({ profileId: z.string().max(100).nullable() })
      .strict()
      .parse(await req.json())
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
      if (
        profileId &&
        !(await tx.uploadProfile.findFirst({
          where: { id: profileId, userId: user.id },
        }))
      )
        return false
      await tx.user.update({
        where: { id: user.id },
        data: { defaultUploadProfileId: profileId },
      })
      return true
    })
    return saved
      ? Response.json({ data: { defaultProfileId: profileId } })
      : Response.json({ error: 'Profile not found.' }, { status: 404 })
  } catch (error) {
    return profileError(error)
  }
}
