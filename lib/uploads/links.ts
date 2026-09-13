import type { ResolvedUploadOptions } from './schema'

export function uploadLinks(
  file: {
    id: string
    urlPath: string
    name: string
    mimeType: string
    size: number
  },
  user: { urlId: string; vanityId: string | null },
  options: Pick<ResolvedUploadOptions, 'copyFormat'>
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
  const escapedName = file.name
    .replace(/[\\\[\]<>`*_]/g, '\\$&')
    .replace(/[\r\n]/g, ' ')
  const htmlName = file.name.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  )
  const formats = {
    page,
    raw,
    download,
    markdown: `[${escapedName}](${page})`,
    html: `<a href="${page.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${htmlName}</a>`,
  }
  // Preserve data.url as a URL for old clients; copyText explicitly carries markup.
  return {
    url: ['raw', 'download'].includes(options.copyFormat)
      ? formats[options.copyFormat]
      : page,
    pageUrl: page,
    rawUrl: raw,
    downloadUrl: download,
    copyText: formats[options.copyFormat],
    name: file.name,
    size: Math.round(file.size * 1024 * 1024),
    type: file.mimeType,
  }
}
