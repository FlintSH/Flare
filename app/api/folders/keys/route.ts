import { folderRoutes } from '@/lib/folders/http'
import { folderKeysInputSchema } from '@/lib/folders/schema'
import { storeFolderKeys } from '@/lib/folders/service'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/folders/keys', folderRoutes)

/**
 * Stores folder key pairs and parent stanzas that the owner's browser made
 * (docs/e2ee-spec.md, sections 8.4.2 and 9.4.5): for a folder from before
 * encryption, whose plain name is deleted here, and for a folder that waits
 * for new keys after sharing stopped. Only a browser session can call it: a
 * token has no account key to seal a folder key with.
 */
export const PUT = api(async (request) => {
  const { user } = await requireSession(request, 'folders.manage', {
    refuseApiCredentials: true,
  })
  const input = await readJson(request, folderKeysInputSchema)
  return apiResponse(await storeFolderKeys(user.id, input))
})
