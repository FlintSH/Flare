import { fileUrls } from '@/lib/files/urls'
import { publicOrigin } from '@/lib/security/public-origin'
import { mbToBytes } from '@/lib/utils/size'

export function uploadLinks(
  file: {
    id: string
    urlPath: string
    name: string
    mimeType: string
    size: number
  },
  user: { urlId: string; vanityId: string | null }
) {
  const urls = fileUrls(file, {
    origin: (publicOrigin()?.href ?? 'http://localhost:3000').replace(
      /\/+$/,
      ''
    ),
    owner: user,
  })
  return {
    url: urls.page,
    pageUrl: urls.page,
    rawUrl: urls.content,
    downloadUrl: urls.download,
    // Keep previously downloaded uploader configurations working.
    copyText: urls.page,
    name: file.name,
    size: Math.round(mbToBytes(file.size)),
    type: file.mimeType,
  }
}
