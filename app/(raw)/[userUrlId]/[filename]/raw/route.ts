import { authorizeFile, serveFile } from '@/lib/files/delivery'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/raw', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
  cors: 'file',
})

export const GET = api(
  async (request, { params }: Context) => {
    const grant = await authorizeFile(request, await params, 'content')
    if (grant instanceof Response) return grant
    // Nothing at this address can show an encrypted file: the bytes are
    // ciphertext, and the key never reaches the server. The share page
    // decrypts them in the browser (docs/e2ee-spec.md, section 11.3).
    if (grant.file.encrypted) return new Response(null, { status: 404 })
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

export const OPTIONS = preflight('file')
