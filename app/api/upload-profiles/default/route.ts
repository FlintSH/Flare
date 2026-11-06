import { z } from 'zod'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'

const api = routes('/api/upload-profiles/default', uploadProfileRoutes)

export const PUT = api(async (request) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request)
  const { profileId } = z
    .object({ profileId: z.string().max(100).nullable() })
    .strict()
    .parse(await readJson(request))
  const saved = await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, user.id)
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
  if (!saved) throw new HttpError(404, 'Profile not found.')
  return Response.json({ data: { defaultProfileId: profileId } })
})
