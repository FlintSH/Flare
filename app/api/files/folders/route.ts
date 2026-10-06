import { apiResponse } from '@/lib/api/response'
import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { folderErrorResponse, folderMutationGuard } from '@/lib/folders/http'
import { fileFoldersInputSchema } from '@/lib/folders/schema'
import { moveFilesToFolder } from '@/lib/folders/service'

async function handlePOST(request: Request) {
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

export async function POST(request: Request) {
  return withAuditRoute(async () => handlePOST(request), {
    route: '/api/files/folders',
  })(request)
}
