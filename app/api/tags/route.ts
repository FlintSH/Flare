import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { tagInputSchema } from '@/lib/tags/schema'
import { tagView, tagViewSelect } from '@/lib/tags/service'

const api = routes('/api/tags', tagRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const tags = await prisma.vaultTag.findMany({
    where: { userId: user.id },
    orderBy: { normalizedName: 'asc' },
    select: tagViewSelect,
  })
  const result = apiResponse(tags.map(tagView))
  result.headers.set('Cache-Control', 'private, no-store')
  return result
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const input = tagInputSchema.parse(await readJson(request))
  const tag = await prisma.vaultTag.create({
    data: {
      ...input,
      userId: user.id,
      normalizedName: input.name.toLowerCase(),
    },
    select: tagViewSelect,
  })
  return apiResponse(tagView(tag))
})
