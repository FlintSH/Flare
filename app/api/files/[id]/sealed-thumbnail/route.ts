import { prisma } from '@/lib/database/prisma'
import { authorizeFile } from '@/lib/files/delivery'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/sealed-thumbnail', {
  failure: { message: 'Error serving the sealed thumbnail' },
  logger: loggers.files,
  cors: 'file',
})

/**
 * The sealed thumbnail of an encrypted file: ciphertext that only a client
 * with the file key opens (docs/e2ee-spec.md, section 12.1). The same rules
 * decide who may read it as decide who may fetch the file's ciphertext. A
 * file without a thumbnail answers 204, so a list of cards makes no failed
 * requests.
 */
export const GET = api(async (request, { params }: Context) => {
  const { id } = await params
  const grant = await authorizeFile(request, { id }, 'thumbnail')
  if (grant instanceof Response) return grant
  const headers = {
    // Ciphertext, but only for those who may read the file.
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  }
  const sealed = grant.file.encrypted
    ? await prisma.fileSealedData.findUnique({
        where: { fileId: grant.file.id },
        select: { sealedThumbnail: true },
      })
    : null
  if (!sealed?.sealedThumbnail)
    return new Response(null, { status: 204, headers })
  return new Response(Uint8Array.from(sealed.sealedThumbnail), {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
  })
})

export const OPTIONS = preflight('file')
