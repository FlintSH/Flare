import { fileTypeFromBuffer } from 'file-type'

export interface FileValidationResult {
  valid: boolean
  detectedType: string | null
}

// video/audio subtypes vary wildly between browsers — just match on the prefix
const FLEXIBLE_PREFIXES = ['video/', 'audio/']

// Groups of MIME types that are functionally equivalent. The byte-detected type
// and the browser-claimed type frequently disagree on these, yet both are
// legitimate, so a match anywhere within a group is accepted (in either
// direction).
const MIME_EQUIVALENCE_GROUPS: string[][] = [
  // ZIP and its many vendor spellings. Windows reports x-zip-compressed which
  // does not match the detected application/zip (GitHub #174).
  [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
    'multipart/x-zip',
  ],
  ['application/gzip', 'application/x-gzip', 'application/x-gunzip'],
  ['application/x-7z-compressed', 'application/x-7z'],
  ['application/x-rar-compressed', 'application/vnd.rar', 'application/x-rar'],
  ['application/x-tar', 'application/tar', 'application/x-gtar'],
  ['application/x-bzip2', 'application/bzip2'],
  ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  ['image/x-icon', 'image/vnd.microsoft.icon'],
  ['image/heic', 'image/heif'],
  ['application/xml', 'text/xml', 'image/svg+xml'],
  ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'],
  // The mp4 container is used for both audio (m4a) and video; detection and the
  // browser often pick different prefixes for the very same file.
  [
    'video/mp4',
    'video/quicktime',
    'video/x-m4v',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
  ],
  [
    'application/x-msdownload',
    'application/vnd.microsoft.portable-executable',
    'application/x-dosexec',
  ],
]

// Formats that are physically ZIP archives. file-type usually reports the
// generic application/zip for these while the browser sends the specific type.
const ZIP_CONTAINER_FORMATS = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
  'application/epub+zip',
  'application/java-archive',
  'application/vnd.android.package-archive',
])

const ZIP_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'multipart/x-zip',
])

function inSameGroup(a: string, b: string): boolean {
  return MIME_EQUIVALENCE_GROUPS.some(
    (group) => group.includes(a) && group.includes(b)
  )
}

export function mimeTypesMatch(detected: string, claimed: string): boolean {
  if (detected === claimed) return true

  if (inSameGroup(detected, claimed)) return true

  // A generic ZIP detection is compatible with any known zip-based document or
  // archive type (and vice versa), since they share the same container bytes.
  if (ZIP_TYPES.has(detected) && ZIP_CONTAINER_FORMATS.has(claimed)) return true
  if (ZIP_TYPES.has(claimed) && ZIP_CONTAINER_FORMATS.has(detected)) return true

  if (
    FLEXIBLE_PREFIXES.some(
      (p) => detected.startsWith(p) && claimed.startsWith(p)
    )
  ) {
    return true
  }

  return false
}

// checks actual file bytes against what the client claimed.
// can't detect text-based formats (html, json, etc.) — those fall through
// as valid since they're already sandboxed when served.
export async function validateFileType(
  buffer: Buffer,
  claimedMimeType: string
): Promise<FileValidationResult> {
  const detected = await fileTypeFromBuffer(buffer)

  if (!detected) {
    return { valid: true, detectedType: null }
  }

  if (mimeTypesMatch(detected.mime, claimedMimeType)) {
    return { valid: true, detectedType: detected.mime }
  }

  return { valid: false, detectedType: detected.mime }
}
