import { folderRoutes } from '@/lib/folders/http'
import { folderIdSchema } from '@/lib/folders/schema'
import { folderRepairs } from '@/lib/folders/service'
import { requireSession } from '@/lib/http/access'
import { parseInput } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/folders/repairs', {
  ...folderRoutes,
  headers: { 'Cache-Control': 'private, no-store' },
})

/**
 * The key material that the folders and files of the account miss, for the
 * owner's browser to make (docs/e2ee-spec.md, sections 8.4 and 9.4.4). The
 * answer holds records and IDs only. Nothing in it is secret.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  // `after` pages the files, past ones that this browser could not open.
  const after = new URL(request.url).searchParams.get('after')
  return apiResponse(
    await folderRepairs(
      user.id,
      after === null ? null : parseInput(folderIdSchema, after)
    )
  )
})
