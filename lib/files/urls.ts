/**
 * The public addresses of stored files, built one way for server and browser
 * code. They are root-relative unless given the instance's origin. Short links
 * are built by `shortLinkUrl` in `lib/links/schema`.
 */

export interface FileAddress {
  id: string
  /** As stored: `/{urlId}/{name}`. */
  urlPath: string
}

export interface FileUrlOptions {
  /** The instance's address without a trailing slash, for absolute URLs. */
  origin?: string
  /** A file password. Every address but the share page carries it. */
  password?: string | null
  /** Address the share page by the owner's vanity ID when they have one. */
  owner?: { urlId: string; vanityId: string | null }
}

export interface FileUrls {
  /** The share page. It never carries a password, so it is safe to copy. */
  page: string
  raw: string
  /** The bytes under `/api/files`, which upload responses call `rawUrl`. */
  content: string
  /** JSON naming where a video plays from. */
  direct: string
  /**
   * Redirects to where the bytes are best fetched, for players and previews
   * that keep the address: fresh storage URL each time, or `raw`.
   */
  media: string
  thumbnail: string
  download: string
  ocr: string
}

// `$ & + , : ; = @ [ ] |`: browsers leave these as typed in a URL path, and
// encodeURIComponent escapes them.
const keptAsTyped = /%(?:24|26|2B|2C|3A|3B|3D|40|5B|5D|7C)/g

/**
 * A path segment escaped the way browsers escape a URL path, so a link reads
 * the same whether Flare or an address bar wrote it. Unlike a browser, this
 * also escapes what would change where the link goes: `#`, `?`, `%`, `\`,
 * tabs and line breaks.
 */
function encodeSegment(segment: string) {
  return encodeURIComponent(segment).replace(keptAsTyped, decodeURIComponent)
}

/** Always one leading slash, so no stored path can name another host. */
function encodePath(path: string) {
  return `/${path.replace(/^\/+/, '').split('/').map(encodeSegment).join('/')}`
}

/**
 * A stored path under another of its owner's IDs: `/{from}/{name}` becomes
 * `/{to}/{name}`. A path under any other ID stays as it is.
 */
export function withOwnerId(urlPath: string, from: string, to: string) {
  return urlPath.startsWith(`/${from}/`)
    ? `/${to}${urlPath.slice(from.length + 1)}`
    : urlPath
}

function sharePagePath(urlPath: string, owner: FileUrlOptions['owner']) {
  return owner?.vanityId
    ? withOwnerId(urlPath, owner.urlId, owner.vanityId)
    : urlPath
}

/** A URL with a file password in its query, as the password form sends it. */
export function withPassword(url: string, password?: string | null) {
  return password ? `${url}?${new URLSearchParams({ password })}` : url
}

/** The addresses that name a file by its ID, for callers without its path. */
export function fileIdUrls(
  id: string,
  { origin = '', password }: Omit<FileUrlOptions, 'owner'> = {}
): Pick<FileUrls, 'thumbnail' | 'download' | 'ocr'> {
  const address = (route: string) =>
    withPassword(`${origin}/api/files/${encodeSegment(id)}/${route}`, password)
  return {
    thumbnail: address('thumbnail'),
    download: address('download'),
    ocr: address('ocr'),
  }
}

export function fileUrls(
  file: FileAddress,
  { origin = '', password, owner }: FileUrlOptions = {}
): FileUrls {
  const path = encodePath(file.urlPath)
  const address = (route: string) => withPassword(`${origin}${route}`, password)
  return {
    page: `${origin}${encodePath(sharePagePath(file.urlPath, owner))}`,
    raw: address(`${path}/raw`),
    content: address(`/api/files${path}`),
    direct: address(`${path}/direct`),
    media: address(`${path}/media`),
    ...fileIdUrls(file.id, { origin, password }),
  }
}

/**
 * Whether Next's image optimizer may resize a file's thumbnail. It fetches
 * without the viewer's session, so only a public file without a password
 * qualifies. Animated GIFs would lose their animation; SVG thumbnails use
 * the browser directly because Next's optimizer intentionally rejects SVG.
 */
export function canOptimizeThumbnail(file: {
  visibility: string
  hasPassword: boolean
  mimeType: string
}) {
  return (
    file.visibility === 'PUBLIC' &&
    !file.hasPassword &&
    file.mimeType !== 'image/gif' &&
    file.mimeType !== 'image/svg+xml'
  )
}

export function sharedFolderUrl(
  token: string,
  { origin = '', page = 1 }: { origin?: string; page?: number } = {}
) {
  return `${origin}/s/folders/${encodeSegment(token)}${page > 1 ? `?page=${page}` : ''}`
}

/**
 * Where a shared folder's locked tile leads: a page that checks the file's
 * password before revealing the file's own address.
 */
export function sharedFolderFileUrl(token: string, fileId: string) {
  return `/s/folders/${encodeSegment(token)}/files/${encodeSegment(fileId)}`
}
