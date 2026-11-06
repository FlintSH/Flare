import { requireSession } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { createProfile, listProfiles } from '@/lib/uploads/profiles'
import { RECIPE_MAX_BYTES, newProfileInput } from '@/lib/uploads/schema'

const api = routes('/api/upload-profiles', uploadProfileRoutes)

export const GET = api(async () => {
  const { user } = await requireSession('uploadProfiles.manage')
  return Response.json({ data: await listProfiles(user) })
})

export const POST = api(async (request) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request)
  const input = newProfileInput(
    await readJson(request, { limit: RECIPE_MAX_BYTES })
  )
  return Response.json(
    { data: await createProfile(user.id, input) },
    { status: 201 }
  )
})
