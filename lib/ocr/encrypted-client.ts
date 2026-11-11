import { apiRequest } from '@/lib/client/request'
import type { DecryptedContent } from '@/lib/e2ee/client/file-worker'
import {
  type OpenedFile,
  openSealedOcrText,
  sealedOcrTextRecord,
} from '@/lib/e2ee/client/files'
import { fetchDecrypted } from '@/lib/files/encrypted-client'
import { normalizedType } from '@/lib/files/safe-render'
import { isReadableImage } from '@/lib/uploads/client'

import {
  OCR_IMAGE_MAX_BYTES,
  type RecognizedText,
  recognizeImage,
} from './browser'

/**
 * The text of an encrypted image (docs/e2ee-spec.md, section 9.6). If the
 * owner's sealed text is stored, this browser opens it with the file key.
 * If not, it reads the image itself. Only the owner stores the result: a
 * visitor's text stays in the visitor's browser (section 9.6.3).
 */

export interface EncryptedImage {
  readonly id: string
  readonly urlPath: string
}

/** What `GET /api/files/{id}/ocr` answers for an encrypted file. */
interface SealedTextAnswer {
  encrypted?: boolean
  sealedOcrText?: string | null
}

/** Whether text can be read from a decrypted file of this type. */
export function canReadText(type: string) {
  return isReadableImage(normalizedType(type))
}

/** The plaintext of an image as a Blob of its own type, which is one of a fixed list. */
function imageBlob(content: DecryptedContent, type: string) {
  return new Blob(content.parts, { type: normalizedType(type) })
}

/** Reads the image in this browser. `content` is its plaintext if the page has it already. */
export async function recognizeEncryptedImage(
  file: EncryptedImage,
  opened: OpenedFile,
  {
    content,
    signal,
  }: { content?: DecryptedContent | Blob | null; signal?: AbortSignal } = {}
): Promise<RecognizedText> {
  if (!canReadText(opened.type))
    throw new Error(
      'Text can be read from PNG, JPEG, WebP, GIF and BMP images.'
    )
  const plain =
    content ??
    (await fetchDecrypted(file, opened, {
      signal,
      maxBytes: OCR_IMAGE_MAX_BYTES,
    }))
  return recognizeImage(
    plain instanceof Blob ? plain : imageBlob(plain, opened.type),
    { signal }
  )
}

/** Stores the owner's sealed text. The server marks the file for the tag rules on text. */
export async function storeSealedText(
  fileId: string,
  opened: OpenedFile,
  text: string,
  signal?: AbortSignal
) {
  await apiRequest(`/api/files/${encodeURIComponent(fileId)}/work`, {
    body: { sealedOcrText: sealedOcrTextRecord(opened, text) },
    signal,
    fallback: 'The text could not be saved.',
  })
}

/**
 * "Extract text" for an encrypted image: the stored text if there is one,
 * otherwise a recognition in this browser. With `store`, which only the
 * owner's page sets, the new text is sealed and saved.
 */
export async function extractEncryptedText(
  ocrUrl: string,
  file: EncryptedImage,
  opened: OpenedFile,
  {
    store = false,
    content,
    signal,
  }: {
    store?: boolean
    content?: DecryptedContent | Blob | null
    signal?: AbortSignal
  } = {}
): Promise<RecognizedText & { stored: boolean }> {
  const answer = await apiRequest<SealedTextAnswer>(ocrUrl, {
    signal,
    whole: true,
    fallback: 'Couldn’t extract text. Please try again.',
  })
  if (answer.sealedOcrText)
    try {
      return {
        text: openSealedOcrText(opened, answer.sealedOcrText),
        confidence: null,
        stored: true,
      }
    } catch {
      // A record that does not open is ignored: the image is read again.
    }
  const recognized = await recognizeEncryptedImage(file, opened, {
    content,
    signal,
  })
  if (!store) return { ...recognized, stored: false }
  let stored = false
  try {
    await storeSealedText(file.id, opened, recognized.text, signal)
    stored = true
  } catch {
    // The text still shows. The background work can store it later.
  }
  return { ...recognized, stored }
}
