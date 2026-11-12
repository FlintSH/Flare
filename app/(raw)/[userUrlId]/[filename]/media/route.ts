import { authorizeFile } from '@/lib/files/delivery'
import { fileKind } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { getStorageProvider } from '@/lib/storage'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/media', {
  failure: { message: 'Internal server error' },
  cors: 'file',
})

/**
 * An address for a file's bytes that outlives any storage URL: each request
 * is checked, then sent to a newly signed storage URL for video and audio
 * when storage has one, and to the file's `/raw` content otherwise. Players
 * and previews that keep an address can keep this one.
 */
export const GET = api(
  async (request, { params }: Context) => {
    const grant = await authorizeFile(request, await params, 'content', {
      urlPath: true,
    })
    if (grant instanceof Response) return grant
    const { file, password } = grant
    const { kind } = fileKind(file)
    const stored =
      kind === 'video' || kind === 'audio'
        ? await (await getStorageProvider()).getPublicUrl(file.path)
        : null
    return new Response(null, {
      status: 302,
      headers: {
        Location: stored ?? fileUrls(file, { password }).raw,
        // The next request must be checked, and signed, again.
        'Cache-Control': 'private, no-store',
      },
    })
  },
  { audit: { action: 'file.read', category: 'files' } }
)

export const OPTIONS = preflight('file')
