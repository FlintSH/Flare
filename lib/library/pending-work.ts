import {
  type EncryptedRecordsWire,
  type OpenedFile,
  openSealedOcrText,
  sealedOcrTextRecord,
  sealedThumbnailRecord,
} from '@/lib/e2ee/client/files'
import { normalizedType } from '@/lib/files/safe-render'
import { thumbnailKind } from '@/lib/files/thumbnail-client'
import { type OwnedTagView, matchingRuleTagIds } from '@/lib/tags/owned'
import { isReadableImage } from '@/lib/uploads/client'

/**
 * The work that waits for the browser of the owner (docs/e2ee-spec.md,
 * section 9.7): the tag rules, the text of an image and the thumbnail of a
 * file that a script client uploaded without them, and the tag rules on a
 * plain file, which the server cannot apply once rules are sealed.
 *
 * It runs in the background, a few files at a time. A file that fails is
 * reported, waited for and left: the server stops listing it after three
 * failed runs, so no browser loops on it.
 */

export type PendingFile =
  | {
      readonly id: string
      readonly encrypted: true
      readonly urlPath: string
      readonly rulesPending: boolean
      readonly ocrPending: boolean
      readonly thumbnailPending: boolean
      readonly encryption: EncryptedRecordsWire
      readonly sealedOcrText: string | null
    }
  | {
      readonly id: string
      readonly encrypted: false
      readonly name: string
      readonly mimeType: string
      readonly ocrText: string | null
      readonly rulesPending: boolean
    }

export interface PendingDeps {
  /** The files that wait, after an ID, and how many wait in all. */
  pending(after?: string): Promise<{ total: number; files: PendingFile[] }>
  work(id: string, body: Record<string, unknown>): Promise<unknown>
  unwrap(records: EncryptedRecordsWire): Promise<OpenedFile>
  /** The tags as this browser opened them, or null while it cannot read each of them. */
  tags(): Promise<readonly OwnedTagView[] | null>
  /**
   * The plaintext of an encrypted file. Rejects with a `RangeError` for a
   * file over `maxBytes`: that work is then recorded as not possible.
   */
  plaintext(
    file: { id: string; urlPath: string },
    opened: OpenedFile,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<Blob>
  thumbnail(file: Blob, type: string): Promise<Uint8Array | null>
  recognize(image: Blob, signal?: AbortSignal): Promise<{ text: string }>
  signal?: AbortSignal
  report?(done: number, total: number): void
  unpaused?(): Promise<void>
  /** Told each file that changed, so its card and its cached thumbnail refresh. */
  changed?(file: PendingFile, body: Record<string, unknown>): void
  sleep?(ms: number): Promise<void>
  /** How many files are worked on at once. */
  concurrency?: number
}

export const PENDING_CONCURRENCY = 2
/** The largest image this browser reads text from or draws. */
export const PENDING_IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** The largest video this browser downloads for one frame. */
export const PENDING_VIDEO_MAX_BYTES = 150 * 1024 * 1024
const BACKOFF_MS = [1_000, 4_000, 15_000, 30_000]

const tooLarge = (error: unknown) => error instanceof RangeError

async function workOn(file: PendingFile, deps: PendingDeps) {
  const tags = await deps.tags()
  const body: Record<string, unknown> = {}
  if (!file.encrypted) {
    // The server read the name and the text of a plain file. The rules are
    // sealed, so this browser matches them (section 9.5).
    if (!tags) return null
    body.rulesApplied = true
    body.ruleTagIds = matchingRuleTagIds(tags, file)
    return body
  }
  const opened = await deps.unwrap(file.encryption)
  const type = normalizedType(opened.type)
  const kind = thumbnailKind(type)
  const readable = isReadableImage(type)
  let ocrText: string | null = null
  if (file.sealedOcrText)
    try {
      ocrText = openSealedOcrText(opened, file.sealedOcrText)
    } catch {
      ocrText = null
    }
  const wantsThumbnail = file.thumbnailPending && kind !== null
  const wantsText = file.ocrPending && readable
  let plain: Blob | null = null
  let oversized = false
  if (wantsThumbnail || wantsText)
    try {
      plain = await deps.plaintext(
        file,
        opened,
        kind === 'video' ? PENDING_VIDEO_MAX_BYTES : PENDING_IMAGE_MAX_BYTES,
        deps.signal
      )
    } catch (error) {
      if (!tooLarge(error)) throw error
      oversized = true
    }
  if (file.thumbnailPending) {
    const thumbnail =
      plain && wantsThumbnail ? await deps.thumbnail(plain, type) : null
    if (thumbnail)
      body.sealedThumbnail = sealedThumbnailRecord(opened, thumbnail)
    // Not an image or a video, too large, or not decodable here.
    else body.thumbnail = 'none'
  }
  if (file.ocrPending) {
    if (plain && wantsText && !oversized) {
      ocrText = (await deps.recognize(plain, deps.signal)).text
      body.sealedOcrText = sealedOcrTextRecord(opened, ocrText)
    } else body.ocr = 'none'
  }
  // A new text can match a rule on text, so the rules run again with it.
  if ((file.rulesPending || body.sealedOcrText) && tags) {
    body.rulesApplied = true
    body.ruleTagIds = matchingRuleTagIds(tags, { name: opened.name, ocrText })
  }
  return Object.keys(body).length ? body : null
}

export interface PendingResult {
  processed: number
  failed: number
}

export async function processPendingWork(
  deps: PendingDeps
): Promise<PendingResult> {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const result: PendingResult = { processed: 0, failed: 0 }
  let consecutiveFailures = 0
  let total = 0
  let after: string | undefined
  for (;;) {
    deps.signal?.throwIfAborted()
    const page = await deps.pending(after)
    if (!page.files.length) break
    total = Math.max(total, result.processed + result.failed + page.total)
    deps.report?.(result.processed + result.failed, total)
    const queue = [...page.files]
    const worker = async () => {
      for (;;) {
        const file = queue.shift()
        if (!file) return
        await deps.unpaused?.()
        deps.signal?.throwIfAborted()
        try {
          const body = await workOn(file, deps)
          if (body) {
            await deps.work(file.id, body)
            deps.changed?.(file, body)
          }
          result.processed++
          consecutiveFailures = 0
        } catch (error) {
          if (deps.signal?.aborted) throw error
          result.failed++
          // The server counts the attempt and stops listing the file after
          // three. A request that fails too changes nothing: this run does
          // not come back to the file.
          await deps.work(file.id, { failed: true }).catch(() => undefined)
          await sleep(
            BACKOFF_MS[Math.min(consecutiveFailures++, BACKOFF_MS.length - 1)]
          )
        }
        deps.report?.(result.processed + result.failed, total)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.max(1, deps.concurrency ?? PENDING_CONCURRENCY) },
        worker
      )
    )
    // Every file of this page was handled one time. Move past it.
    after = page.files[page.files.length - 1].id
  }
  return result
}
