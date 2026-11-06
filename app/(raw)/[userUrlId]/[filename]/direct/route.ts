import { NextResponse } from 'next/server'

import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { requestIp } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess, fileAccessDeniedHeaders } from '@/lib/files/access'
import { resolveFileUrlPath } from '@/lib/files/resolve'
import { routes } from '@/lib/http/route'
import { getStorageProvider } from '@/lib/storage'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/direct', {
  failure: { message: 'Internal server error' },
})

export const GET = api(
  async (request, { params }: Context) => {
    const session = await getAccessSession()
    const { userUrlId, filename } = await params
    const url = new URL(request.url)
    const providedPassword = url.searchParams.get('password')

    const urlPath = await resolveFileUrlPath(userUrlId, filename)

    if (!urlPath) {
      return new Response(null, { status: 404 })
    }

    const file = await prisma.file.findUnique({
      where: { urlPath },
    })

    if (!file) {
      return new Response(null, { status: 404 })
    }

    setAuditTarget({ type: 'file', id: file.id, name: file.name })

    const access = await checkFileAccess(file, session, providedPassword, {
      requester: requestIp(request.headers),
    })
    if (!access.allowed) {
      setAuditOutcome('denied')
      return new Response(null, {
        status: access.status,
        headers: fileAccessDeniedHeaders(access),
      })
    }

    const isVideo = file.mimeType.startsWith('video/')
    if (!isVideo) {
      return new Response(null, {
        status: 400,
        statusText: 'Not a video file',
      })
    }

    const storageProvider = await getStorageProvider()

    const directUrl = await storageProvider.getPublicUrl(file.path)
    if (directUrl) {
      return NextResponse.json({ url: directUrl })
    }

    const rawUrl = `${file.urlPath}/raw${providedPassword ? `?${new URLSearchParams({ password: providedPassword })}` : ''}`
    return NextResponse.json({ url: rawUrl })
  },
  { audit: { action: 'file.read', category: 'files' } }
)
