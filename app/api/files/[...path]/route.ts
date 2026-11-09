import { authorizeFile, serveFile } from '@/lib/files/delivery'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const logger = loggers.files

type Context = { params: Promise<{ path: string[] }> }

const api = routes('/api/files/[...path]', {
  failure: { message: 'Internal server error' },
  logger,
  cors: 'file',
})

async function serveContent(request: Request, { params }: Context) {
  try {
    const { path } = await params
    const download =
      new URL(request.url).searchParams.get('download') === 'true'
    const grant = await authorizeFile(
      request,
      { urlPath: '/' + path.join('/') },
      'content'
    )
    if (grant instanceof Response) return grant
    const { file } = grant
    return await serveFile(request, file, {
      disposition: download ? 'attachment' : 'inline',
      sandbox: true,
      publicCache: file.mimeType.startsWith('video/')
        ? 'public, max-age=31536000'
        : 'no-cache',
      count: download ? 'downloads' : undefined,
    })
  } catch (error) {
    logger.error('File serve error:', error as Error)
    return new Response(null, { status: 404 })
  }
}

// The downloads counter is not a separate change event, so the request event
// records whether this was a download.
export const GET = api(serveContent, {
  audit: {
    action: (request) =>
      new URL(request.url).searchParams.get('download') === 'true'
        ? 'file.download'
        : 'file.read',
    category: 'files',
  },
})

export const OPTIONS = preflight('file')
