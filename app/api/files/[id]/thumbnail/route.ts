import { authorizeFile, serveFile } from '@/lib/files/delivery'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/thumbnail', {
  failure: { message: 'Error serving thumbnail' },
  logger: loggers.files,
})

export const GET = api(
  async (request, { params }: Context) => {
    const { id } = await params
    const grant = await authorizeFile(request, { id }, 'thumbnail')
    if (grant instanceof Response) return grant
    // Checked after access, so a file the requester can't read stays hidden.
    if (!grant.file.mimeType.startsWith('image/'))
      return new Response('Not an image', { status: 400 })

    // The original image, sized by the browser. Its stored type is
    // client-supplied and can be SVG, which the sandbox keeps from running.
    return serveFile(request, grant.file, {
      sandbox: true,
      publicCache: 'public, max-age=31536000, immutable',
      whole: true,
    })
  },
  { audit: { action: 'file.thumbnail', category: 'files' } }
)
