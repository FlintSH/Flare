import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { createProfile, listProfiles } from '@/lib/uploads/profiles'
import { RECIPE_MAX_BYTES, newProfileInput } from '@/lib/uploads/schema'

const api = routes('/api/upload-profiles', uploadProfileRoutes)

export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'uploadProfiles.manage')
  return Response.json({ data: await listProfiles(user) })
})

export const POST = api(async (request) => {
  const { user } = await requireSession(request, 'uploadProfiles.manage')
  const input = newProfileInput(
    await readJson(request, { limit: RECIPE_MAX_BYTES })
  )
  return Response.json(
    { data: await createProfile(user.id, input) },
    { status: 201 }
  )
})
