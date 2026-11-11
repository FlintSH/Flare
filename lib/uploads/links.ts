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
    encrypted?: boolean
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
  // The server has no name and no type to send, and no link that opens the
  // file: the client that encrypted it adds the key after `#`
  // (docs/e2ee-spec.md, section 10.3).
  if (file.encrypted)
    return {
      encrypted: true as const,
      id: file.id,
      url: urls.page,
      pageUrl: urls.page,
      size: Math.round(mbToBytes(file.size)),
    }
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
