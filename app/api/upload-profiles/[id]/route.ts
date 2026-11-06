import { z } from 'zod'

import { requireSession } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { uploadProfileRoutes } from '@/lib/uploads/http'
import { deleteProfile, updateProfile } from '@/lib/uploads/profiles'
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
  return Response.json({
    data: await updateProfile(user.id, id, revision, input),
  })
})

export const DELETE = api(async (request, { params }: Context) => {
  const { user } = await requireSession('uploadProfiles.manage')
  assertJsonMutation(request, { body: false })
  const { id } = await params
  await deleteProfile(user.id, id)
  return Response.json({ data: { deleted: true } })
})
