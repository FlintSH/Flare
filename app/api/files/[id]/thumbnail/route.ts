import { authorizeFile, cacheHeaders, serveFile } from '@/lib/files/delivery'
import { fileKind } from '@/lib/files/file-kind'
import { resizedThumbnail, thumbnailWidth } from '@/lib/files/thumbnail'
import { videoPoster } from '@/lib/files/video-poster'
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

const webp = (
  image: Buffer,
  file: Parameters<typeof cacheHeaders>[0],
  cache: string
) =>
  new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(image.length),
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      ...cacheHeaders(file, cache),
    },
  })

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
    if (fileKind(grant.file).kind === 'video') {
      // A frame from the video, the same size the video shows.
      const poster = await videoPoster(grant.file, request.signal)
      if (poster === 'busy')
        // The browser gave up while it waited, or too many frames are
        // waiting: ask again soon, rather than keep a missing picture.
        return request.signal.aborted
          ? new Response(null, { status: 204 })
          : new Response('Too many video frames are being made', {
              status: 503,
              headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
            })
      if (!poster)
        return new Response('No frame to show', {
          status: 404,
          // Asked again once ffmpeg may have been installed or storage is back.
          headers: { 'Cache-Control': 'private, max-age=600' },
        })
      // The saved frame as it is when it is no wider than asked, rather
      // than encoded again at the same size.
      const resized =
        width &&
        width < poster.width &&
        (await resizedThumbnail(
          grant.file,
          width,
          request.signal,
          async () => poster.image
        ))
      return webp(resized || poster.image, grant.file, publicCache)
    }
    if (!grant.file.mimeType.startsWith('image/'))
      return new Response('Not an image', { status: 400 })

    // With a width, a small WebP copy when the image can be resized.
    const resized =
      width && (await resizedThumbnail(grant.file, width, request.signal))
    if (resized) return webp(resized, grant.file, publicCache)

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
