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
  const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  )
  const path = user.vanityId
    ? file.urlPath.replace(`/${user.urlId}/`, `/${user.vanityId}/`)
    : file.urlPath
  const encodePath = (value: string) =>
    value
      .split('/')
      .map((segment) =>
        encodeURIComponent(segment).replace(
          /[!'()*]/g,
          (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        )
      )
      .join('/')
  const page = `${base}${encodePath(path)}`
  const raw = `${base}/api/files${encodePath(file.urlPath)}`
  const download = `${base}/api/files/${file.id}/download`
  return {
    url: page,
    pageUrl: page,
    rawUrl: raw,
    downloadUrl: download,
    // Keep previously downloaded uploader configurations working.
    copyText: page,
    name: file.name,
    size: Math.round(file.size * 1024 * 1024),
    type: file.mimeType,
  }
}
