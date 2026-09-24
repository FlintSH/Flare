import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { folderErrorResponse, folderMutationGuard } from '@/lib/folders/http'
import { fileFoldersInputSchema } from '@/lib/folders/schema'
import { moveFilesToFolder } from '@/lib/folders/service'

export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = folderMutationGuard(request)
    if (guarded) return guarded
    const input = fileFoldersInputSchema.parse(await request.json())
    return apiResponse({ count: await moveFilesToFolder(user.id, input) })
  } catch (error) {
    return folderErrorResponse(error)
  }
}
