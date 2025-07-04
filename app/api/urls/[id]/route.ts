import { HTTP_STATUS, apiError } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params

    const url = await prisma.shortenedUrl.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!url) {
      return apiError('URL not found', HTTP_STATUS.NOT_FOUND)
    }

    if (url.userId !== user.id) {
      return apiError('Unauthorized', HTTP_STATUS.FORBIDDEN)
    }

    await prisma.shortenedUrl.delete({
      where: { id },
    })

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT })
  } catch (error) {
    console.error('URL deletion error:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
