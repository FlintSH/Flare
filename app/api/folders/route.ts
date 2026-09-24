import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { folderErrorResponse, folderMutationGuard } from '@/lib/folders/http'
import { folderInputSchema } from '@/lib/folders/schema'
import {
  createFolder,
  folderView,
  folderViewSelect,
} from '@/lib/folders/service'

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const folders = await prisma.vaultFolder.findMany({
      where: { userId: user.id },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      select: folderViewSelect,
    })
    const result = apiResponse(folders.map(folderView))
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    return folderErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = folderMutationGuard(request)
    if (guarded) return guarded
    const input = folderInputSchema.parse(await request.json())
    return apiResponse(await createFolder(user.id, input))
  } catch (error) {
    return folderErrorResponse(error)
  }
}
