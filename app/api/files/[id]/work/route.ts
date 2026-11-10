import { fileWorkSchema, recordFileWork } from '@/lib/files/library-records'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/work', {
  envelope: 'api',
  failure: { message: 'Failed to store the work on this file' },
  logger: loggers.files,
})

/**
 * What the owner's browser did for one of its files: the sealed text of an
 * image, a sealed thumbnail, and the tags that the owner's rules give
 * (docs/e2ee-spec.md, sections 9.6.3, 9.7 and 12.1). The server stores the
 * records without opening them and clears the flags of the work.
 *
 * Only a session of the owner is accepted. A visitor who has the file key
 * can make a valid record, and the server must not take it.
 */
export const POST = api(async (request, { params }: Context) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const { id } = await params
  // The largest body holds a sealed text and a sealed thumbnail in base64url.
  const work = await readJson(request, fileWorkSchema, {
    limit: 1024 * 1024,
  })
  return apiResponse(await recordFileWork(user.id, id, work))
})
