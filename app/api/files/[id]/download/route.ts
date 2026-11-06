import { authorizeFile, serveFile } from '@/lib/files/delivery'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/download', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
})

/** GET takes the password as a query value, POST in a JSON body. */
const download = api(
  async (request, { params }: Context) => {
    const { id } = await params
    const grant = await authorizeFile(request, { id }, 'content')
    if (grant instanceof Response) return grant
    return serveFile(request, grant.file, {
      disposition: 'attachment',
      count: 'downloads',
      signedRedirect: true,
    })
  },
  { audit: { action: 'file.download', category: 'files' } }
)

export { download as GET, download as POST }
