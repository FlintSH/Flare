import { fileTypeFromBuffer } from 'file-type'

export interface FileValidationResult {
  valid: boolean
  detectedType: string | null
}

// video/audio subtypes vary wildly between browsers — just match on the prefix
const FLEXIBLE_PREFIXES = ['video/', 'audio/']

// common cases where detected vs claimed mime differs but both are valid
const MIME_ALIASES: Record<string, string[]> = {
  'video/mp4': ['video/mp4', 'video/quicktime'],
  'audio/mpeg': ['audio/mpeg', 'audio/mp3'],
  'image/jpeg': ['image/jpeg', 'image/jpg'],
  'application/xml': ['application/xml', 'text/xml', 'image/svg+xml'],
}

function mimeTypesMatch(detected: string, claimed: string): boolean {
  if (detected === claimed) return true

  const aliases = MIME_ALIASES[detected]
  if (aliases?.includes(claimed)) return true

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
