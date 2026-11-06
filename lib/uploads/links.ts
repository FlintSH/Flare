import { fileUrls } from '@/lib/files/urls'

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
    origin: (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(
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
    size: Math.round(file.size * 1024 * 1024),
    type: file.mimeType,
  }
}
