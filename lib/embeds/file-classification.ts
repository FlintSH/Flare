import {
  AUDIO_FILE_TYPES,
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
  VIDEO_FILE_TYPES,
} from '@/components/file/protected/mime-types'

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.apple.pages',
  'application/vnd.apple.keynote',
  'application/vnd.apple.numbers',
])

export interface FileClassification {
  isImage: boolean
  isVideo: boolean
  isAudio: boolean
  isDocument: boolean
  isCode: boolean
  isText: boolean
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function isVideo(mimeType: string): boolean {
  return VIDEO_FILE_TYPES.some((type) => mimeType.startsWith(type))
}

export function isAudio(mimeType: string): boolean {
  return (
    mimeType.startsWith('audio/') ||
    AUDIO_FILE_TYPES.some((type) => mimeType.startsWith(type))
  )
}

export function isDocument(mimeType: string): boolean {
  if (DOCUMENT_MIME_TYPES.has(mimeType)) {
    return true
  }

  return (
    mimeType.startsWith('application/vnd.openxmlformats-officedocument') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation') ||
    mimeType.includes('msword')
  )
}

export function isCode(mimeType: string): boolean {
  return Boolean(CODE_FILE_TYPES[mimeType])
}

export function isText(mimeType: string): boolean {
  return (
    TEXT_FILE_TYPES.includes(mimeType) ||
    mimeType.startsWith('text/') ||
    mimeType === 'application/json'
  )
}

export function classifyMimeType(mimeType: string): FileClassification {
  return {
    isImage: isImage(mimeType),
    isVideo: isVideo(mimeType),
    isAudio: isAudio(mimeType),
    isDocument: isDocument(mimeType),
    isCode: isCode(mimeType),
    isText: isText(mimeType),
  }
}
