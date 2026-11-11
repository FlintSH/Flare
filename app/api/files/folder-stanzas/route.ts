import { folderRoutes } from '@/lib/folders/http'
import { fileFolderStanzasInputSchema } from '@/lib/folders/schema'
import { storeFileFolderStanzas } from '@/lib/folders/service'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/files/folder-stanzas', folderRoutes)

/**
 * Stores folder stanzas of public encrypted files (docs/e2ee-spec.md,
 * section 8.4.3), which the owner's browser makes after a file moved, became
 * public, changed its password or got a folder with new keys. An entry for
 * a private file, or for a key that the folder no longer has, is skipped.
 */
export const PUT = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const input = await readJson(request, fileFolderStanzasInputSchema)
  return apiResponse(await storeFileFolderStanzas(user.id, input))
})
