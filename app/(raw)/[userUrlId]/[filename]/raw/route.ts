import { authorizeFile, serveFile } from '@/lib/files/delivery'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/raw', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
})

export const GET = api(
  async (request, { params }: Context) => {
    const grant = await authorizeFile(request, await params, 'content')
    if (grant instanceof Response) return grant
    return serveFile(request, grant.file, {
      disposition: 'inline',
      sandbox: true,
      count: 'views',
      headers: {
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=300, max=1000',
      },
    })
  },
  { audit: { action: 'file.read', category: 'files' } }
)
