import { NextResponse } from 'next/server'

import { authorizeFile } from '@/lib/files/delivery'
import { fileUrls } from '@/lib/files/urls'
import { routes } from '@/lib/http/route'
import { getStorageProvider } from '@/lib/storage'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/direct', {
  failure: { message: 'Internal server error' },
})

export const GET = api(
  async (request, { params }: Context) => {
    const grant = await authorizeFile(request, await params, 'lookup', {
      urlPath: true,
    })
    if (grant instanceof Response) return grant
    const { file, password } = grant

    if (!file.mimeType.startsWith('video/')) {
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

    return NextResponse.json({ url: fileUrls(file, { password }).raw })
  },
  { audit: { action: 'file.read', category: 'files' } }
)
