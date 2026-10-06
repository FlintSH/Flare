import { apiResponse } from '@/lib/api/response'
import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { tagInputSchema } from '@/lib/tags/schema'
import { tagView, tagViewSelect } from '@/lib/tags/service'

async function handleGET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const tags = await prisma.vaultTag.findMany({
      where: { userId: user.id },
      orderBy: { normalizedName: 'asc' },
      select: tagViewSelect,
    })
    const result = apiResponse(tags.map(tagView))
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    return tagErrorResponse(error)
  }
}

async function handlePOST(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = tagMutationGuard(request)
    if (guarded) return guarded
    const input = tagInputSchema.parse(await request.json())
    const tag = await prisma.vaultTag.create({
      data: {
        ...input,
        userId: user.id,
        normalizedName: input.name.toLowerCase(),
      },
      select: tagViewSelect,
    })
    return apiResponse(tagView(tag))
  } catch (error) {
    return tagErrorResponse(error)
  }
}

export async function GET(request: Request) {
  return withAuditRoute(async () => handleGET(request), { route: '/api/tags' })(
    request
  )
}

export async function POST(request: Request) {
  return withAuditRoute(async () => handlePOST(request), {
    route: '/api/tags',
  })(request)
}
