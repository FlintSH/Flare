import { apiError } from '@/lib/api/response'
import { prisma } from '@/lib/database/prisma'
import { requirePermission } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'

/** Moderation stays session-only; named tokens can delete only their owner's links. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; urlId: string }> }
) {
  const { response } = await requirePermission('content.delete')
  if (response) return response
  if (!isSameOriginRequest(request))
    return apiError('Invalid request origin', 403)
  const { id, urlId } = await params
  const result = await prisma.shortenedUrl.deleteMany({
    where: { id: urlId, userId: id },
  })
  if (!result.count) return apiError('URL not found', 404)
  return new Response(null, { status: 204 })
}
