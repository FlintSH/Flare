import { type Language, fileKind } from './file-kind'

/**
 * How the browser may show the decrypted content of an encrypted file
 * (docs/e2ee-spec.md, section 3.3, limit 2).
 *
 * The decrypted `name` and `type` are not trusted. A person who knows the
 * account public key can make a file that decrypts correctly, with any name
 * and any type. Content that a browser could run as a page of Flare's
 * origin (HTML, SVG, XHTML, XML) must never be opened as a document: not by
 * navigation, not in a frame with this origin, not in a new window.
 *
 * So the type selects a renderer from the list below and nothing else. Each
 * renderer cannot run script in this origin:
 *
 * - `image`: an `<img>` element, with a Blob of a fixed raster type.
 * - `svg`: an `<img>` element with a `data:` address. A `data:` address
 *   has no origin of its own to give and browsers refuse to navigate to it,
 *   so "open image in new tab" cannot make it a page of Flare.
 * - `video`, `audio`: a media element, with a Blob of a fixed media type.
 * - `text`: the bytes as text in the code viewer. Never markup.
 * - `pdf`: a sandboxed frame, with a Blob of `application/pdf`.
 * - `download`: no preview. Every type that is not on the list.
 *
 * The Blob type always comes from this file, never from the claimed type.
 * Browser-safe and pure.
 */
export type SafeRenderer =
  'image' | 'svg' | 'video' | 'audio' | 'text' | 'pdf' | 'download'

export type SafeRendering =
  | { renderer: 'image' | 'svg' | 'video' | 'audio' | 'pdf'; blobType: string }
  | { renderer: 'text'; language: Language }
  | { renderer: 'download' }

const RASTER_IMAGES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
  ['image/webp', 'image/webp'],
  ['image/avif', 'image/avif'],
  ['image/bmp', 'image/bmp'],
  ['image/x-icon', 'image/x-icon'],
  ['image/vnd.microsoft.icon', 'image/x-icon'],
])

const VIDEOS = new Map([
  ['video/mp4', 'video/mp4'],
  ['video/webm', 'video/webm'],
  ['video/ogg', 'video/ogg'],
  ['video/quicktime', 'video/mp4'],
])

const AUDIO = new Map([
  ['audio/mpeg', 'audio/mpeg'],
  ['audio/mp3', 'audio/mpeg'],
  ['audio/mp4', 'audio/mp4'],
  ['audio/x-m4a', 'audio/mp4'],
  ['audio/aac', 'audio/aac'],
  ['audio/ogg', 'audio/ogg'],
  ['audio/opus', 'audio/ogg'],
  ['audio/wav', 'audio/wav'],
  ['audio/x-wav', 'audio/wav'],
  ['audio/wave', 'audio/wav'],
  ['audio/webm', 'audio/webm'],
  ['audio/flac', 'audio/flac'],
  ['audio/x-flac', 'audio/flac'],
])

/** The one type every download and every unknown file gets. */
export const DOWNLOAD_BLOB_TYPE = 'application/octet-stream'

/** A claimed type without parameters, in lower case. Not a string gives ''. */
export function normalizedType(type: unknown): string {
  return typeof type === 'string'
    ? type.split(';')[0].trim().toLowerCase().slice(0, 255)
    : ''
}

/**
 * The renderer for a decrypted file. `name` only adds text grammars for a
 * file with a generic type, such as `notes.md`: text is shown as text
 * whatever it contains.
 */
export function safeRendering(file: {
  name?: unknown
  type: unknown
}): SafeRendering {
  const type = normalizedType(file.type)
  const raster = RASTER_IMAGES.get(type)
  if (raster) return { renderer: 'image', blobType: raster }
  if (type === 'image/svg+xml')
    return { renderer: 'svg', blobType: 'image/svg+xml' }
  const video = VIDEOS.get(type)
  if (video) return { renderer: 'video', blobType: video }
  const audio = AUDIO.get(type)
  if (audio) return { renderer: 'audio', blobType: audio }
  if (type === 'application/pdf')
    return { renderer: 'pdf', blobType: 'application/pdf' }
  // `fileKind` gives a text kind only for a text or source type, or for a
  // generic type with a text file name. A media type that is not on the
  // lists above gets a media kind there, which is a download here.
  const kind = fileKind({
    name: typeof file.name === 'string' ? file.name : '',
    mimeType: type || DOWNLOAD_BLOB_TYPE,
  })
  if (kind.kind === 'code' || kind.kind === 'text')
    return { renderer: 'text', language: kind.language }
  if (kind.kind === 'csv') return { renderer: 'text', language: 'text' }
  return { renderer: 'download' }
}

/** The largest decrypted file each renderer loads into memory, in bytes. */
export const INLINE_PREVIEW_MAX_BYTES: Record<
  Exclude<SafeRenderer, 'download'>,
  number
> = {
  image: 64 * 1024 * 1024,
  svg: 2 * 1024 * 1024,
  video: 128 * 1024 * 1024,
  audio: 128 * 1024 * 1024,
  pdf: 64 * 1024 * 1024,
  text: 1024 * 1024,
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const FALLBACK_NAME = 'file'

/**
 * A file name that is safe to show and to give to the `download`
 * attribute: one path segment, no control or bidirectional override
 * characters, no leading dots, no name that Windows reserves, at most 200
 * characters. A value that is not usable text gives `file`.
 */
export function safeFileName(name: unknown): string {
  if (typeof name !== 'string') return FALLBACK_NAME
  const cleaned = name
    .normalize('NFC')
    // Control characters, and the characters that reorder displayed text
    // so `exe.gpj` can read as `jpg.exe`.
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g, '')
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 200)
  if (!cleaned) return FALLBACK_NAME
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned
}

/**
 * Whether this browser can show a PDF inside a frame that has an opaque
 * origin and runs no script, which is the only frame a decrypted PDF gets.
 * Chromium does not load its PDF viewer in such a frame (checked with
 * Chromium 153), and a browser without a built-in viewer has nothing to
 * load. Those browsers offer the download instead.
 */
export function canPreviewSandboxedPdf(browser: {
  pdfViewerEnabled?: boolean
  userAgent?: string
  brands?: readonly { brand: string }[]
}): boolean {
  if (!browser.pdfViewerEnabled) return false
  if (browser.brands?.some(({ brand }) => brand === 'Chromium')) return false
  return !/\b(Chrome|Chromium|CriOS|Edg)\//.test(browser.userAgent ?? '')
}
