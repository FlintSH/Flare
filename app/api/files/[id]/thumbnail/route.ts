import { authorizeFile, cacheHeaders, serveFile } from '@/lib/files/delivery'
import { resizedThumbnail, thumbnailWidth } from '@/lib/files/thumbnail'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/thumbnail', {
  failure: { message: 'Error serving thumbnail' },
  logger: loggers.files,
  cors: 'file',
})

const publicCache = 'public, max-age=31536000, immutable'

export const GET = api(
  async (request, { params }: Context) => {
    const { id } = await params
    const requested = new URL(request.url).searchParams.get('w')
    const width = requested === null ? null : thumbnailWidth(requested)
    if (requested !== null && width === null)
      return new Response('w must be a positive whole number', { status: 400 })
    const grant = await authorizeFile(request, { id }, 'thumbnail', {
      size: true,
    })
    if (grant instanceof Response) return grant
    // Checked after access, so a file the requester can't read stays hidden.
    if (!grant.file.mimeType.startsWith('image/'))
      return new Response('Not an image', { status: 400 })

    // With a width, a small WebP copy when the image can be resized.
    const resized =
      width && (await resizedThumbnail(grant.file, width, request.signal))
    if (resized)
      return new Response(new Uint8Array(resized), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(resized.length),
          'Content-Security-Policy': 'sandbox',
          'X-Content-Type-Options': 'nosniff',
          ...cacheHeaders(grant.file, publicCache),
        },
      })

    // The browser gave up on this preview while it waited, so nobody is left
    // to send the original to.
    if (width && request.signal.aborted)
      return new Response(null, { status: 204 })

    // Otherwise the original image, sized by the browser. Its stored type is
    // client-supplied and can be SVG, which the sandbox keeps from running.
    return serveFile(request, grant.file, {
      sandbox: true,
      publicCache,
      whole: true,
    })
  },
  { audit: { action: 'file.thumbnail', category: 'files' } }
)

export const OPTIONS = preflight('file')
