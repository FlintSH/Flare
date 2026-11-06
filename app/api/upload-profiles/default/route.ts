import { z } from 'zod'

import { requireSession } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { setDefaultProfile } from '@/lib/uploads/profiles'

const api = routes('/api/upload-profiles/default', uploadProfileRoutes)

export const PUT = api(async (request) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request)
  const { profileId } = z
    .object({ profileId: z.string().max(100).nullable() })
    .strict()
    .parse(await readJson(request))
  await setDefaultProfile(user.id, profileId)
  return Response.json({ data: { defaultProfileId: profileId } })
})
