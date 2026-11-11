import {
  type ArchiveInput,
  zipBytes,
} from '@/lib/archives/client/archive-writer'
import {
  type SourceFetch,
  openEncryptedSource,
} from '@/lib/e2ee/client/encrypted-source'
import type { EncryptedRecordsWire, OpenedFile } from '@/lib/e2ee/client/files'
import { fileLayout } from '@/lib/e2ee/file'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import { exportEntryNamer } from '@/lib/files/export-entry-names'
import { normalizedType, safeFileName } from '@/lib/files/safe-render'
import { fileUrls } from '@/lib/files/urls'

/**
 * The account export for an account with encrypted files, built in the
 * browser (docs/e2ee-spec.md, section 12.4). The server cannot decrypt, so
 * the client downloads each file, decrypts the ones it has the key of, and
 * writes one ZIP as a stream.
 *
 * Layout of the ZIP:
 *
 * - `user-data.json`: the account record as the server export writes it.
 *   Each file also has `exportPath`, the path of its entry. An encrypted
 *   file that was decrypted has its real `name` and `mimeType`, and
 *   `decrypted: true`.
 * - `files/<upload date>/<name>`: each file. A plain file as it is stored,
 *   an encrypted file decrypted, under the name from its sealed metadata.
 *   A repeated name on one day is numbered: `report (2).pdf`.
 * - `files/<upload date>/<file ID>.flare-encrypted`: an encrypted file that
 *   no key of this browser opens, as ciphertext, as the server export has
 *   it. Its records stay in `user-data.json`.
 * - `export-report.json`: what was written and what was left out, and why.
 *
 * A file that fails part-way (a failed integrity check, a lost connection)
 * is left out, named in the report, and the export goes on. Run with the
 * cipher in a worker: it is JavaScript.
 */

export interface ManifestFile {
  readonly id: string
  readonly urlPath: string
  readonly sizeBytes: number
  readonly uploadedAt: string
  readonly encrypted: boolean
  /** Null for an encrypted file: the server has no name for it. */
  readonly name: string | null
  readonly encryption?: {
    readonly header: string | null
    readonly sealedMetadata: string | null
    readonly accountStanza: string | null
    readonly stanzaAccountPublicKey: string | null
  }
}

export interface ExportManifest {
  readonly record: Record<string, unknown> & {
    readonly files: readonly Record<string, unknown>[]
  }
  readonly files: readonly ManifestFile[]
}

export type ExportEntryKind = 'plain' | 'decrypted' | 'ciphertext'

export interface ExportEntry {
  readonly file: ManifestFile
  /** The path of the entry in the ZIP. */
  readonly path: string
  readonly kind: ExportEntryKind
  readonly opened?: Pick<OpenedFile, 'fileKey' | 'name' | 'type'>
}

export interface ExportPlan {
  readonly entries: readonly ExportEntry[]
  /** The text of `user-data.json`. */
  readonly userData: string
  /** Bytes of files to read: the ciphertext size for an encrypted file. */
  readonly totalBytes: number
}

export interface ExportProgress {
  readonly filesDone: number
  readonly filesTotal: number
  readonly bytesDone: number
  readonly bytesTotal: number
  /** The name being written. Shown to the person, never sent anywhere. */
  readonly current: string
  readonly skipped: number
}

export interface ExportSummary {
  readonly files: number
  readonly decrypted: number
  readonly plain: number
  /** Encrypted files no key opened, written as ciphertext. */
  readonly notDecrypted: readonly string[]
  /** Entries left out, with the reason. */
  readonly failed: readonly { readonly path: string; readonly reason: string }[]
}

function recordsOf(file: ManifestFile): EncryptedRecordsWire | null {
  const records = file.encryption
  return records?.header && records.sealedMetadata
    ? {
        header: records.header,
        sealedMetadata: records.sealedMetadata,
        accountStanza: records.accountStanza,
        stanzaAccountPublicKey: records.stanzaAccountPublicKey,
      }
    : null
}

/**
 * Names every entry and writes `user-data.json`. `open` gives the key and
 * the sealed name of an encrypted file, or rejects when no key of this
 * browser opens it. No file content is read here.
 */
export async function planExport(
  manifest: ExportManifest,
  open: (records: EncryptedRecordsWire) => Promise<OpenedFile>
): Promise<ExportPlan> {
  const nameOf = exportEntryNamer()
  const entries: ExportEntry[] = []
  const listed: Record<string, unknown>[] = []
  let totalBytes = 0
  for (const [index, file] of manifest.files.entries()) {
    totalBytes += file.sizeBytes
    const record = manifest.record.files[index] ?? {}
    if (!file.encrypted) {
      const path = nameOf({
        name: file.name ?? '',
        uploadedAt: file.uploadedAt,
      })
      entries.push({ file, path, kind: 'plain' })
      listed.push({ ...record, exportPath: path })
      continue
    }
    const records = recordsOf(file)
    const opened = records ? await open(records).catch(() => null) : null
    if (!opened) {
      const path = nameOf({
        name: '',
        uploadedAt: file.uploadedAt,
        encrypted: true,
        urlPath: file.urlPath,
      })
      entries.push({ file, path, kind: 'ciphertext' })
      listed.push({ ...record, exportPath: path, decrypted: false })
      continue
    }
    // The sealed name is not trusted: it is cleaned to one safe path
    // segment before it becomes the name of an entry.
    const name = safeFileName(opened.name)
    const path = nameOf({ name, uploadedAt: file.uploadedAt })
    entries.push({ file, path, kind: 'decrypted', opened })
    listed.push({
      ...record,
      name,
      mimeType: normalizedType(opened.type) || 'application/octet-stream',
      exportPath: path,
      decrypted: true,
    })
  }
  return {
    entries,
    userData: JSON.stringify({ ...manifest.record, files: listed }, null, 2),
    totalBytes,
  }
}

async function* responseBytes(
  response: Response
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = response.body!.getReader()
  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) return
      yield step.value
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

function reasonOf(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'E2eeError')
    return 'The file did not pass its integrity check: it was changed or cut after it was encrypted.'
  if (name === 'SourceError' || name === 'ExportFetchError')
    return 'The server did not send the file. It may have been deleted, or storage could not read it.'
  return 'The file could not be read. Check your connection and export again.'
}

class ExportFetchError extends Error {
  constructor() {
    super('The server did not send the file')
    this.name = 'ExportFetchError'
  }
}

const encoder = new TextEncoder()

function plaintextLengthOf(storedBytes: number): number | undefined {
  try {
    return fileLayout(storedBytes).plaintextLength
  } catch {
    // No encrypted file has this length. Reading it will say why.
    return undefined
  }
}

/**
 * The bytes of the export ZIP. `onDone` gets the summary after the last
 * byte was read by the consumer's loop. Aborting `signal` stops every read.
 */
export function exportArchive(
  plan: ExportPlan,
  environment: {
    readonly fetch: SourceFetch
    readonly signal: AbortSignal
    readonly onProgress?: (progress: ExportProgress) => void
    readonly onDone?: (summary: ExportSummary) => void
  }
): AsyncGenerator<Uint8Array, void, undefined> {
  const { signal } = environment
  const failed: { path: string; reason: string }[] = []
  let filesDone = 0
  let current = ''
  const report = (bytesDone: number) =>
    environment.onProgress?.({
      filesDone,
      filesTotal: plan.entries.length,
      bytesDone,
      bytesTotal: plan.totalBytes,
      current,
      skipped: failed.length,
    })
  const summary = (): ExportSummary => ({
    files: plan.entries.length - failed.length,
    decrypted: plan.entries.filter(
      (entry) =>
        entry.kind === 'decrypted' &&
        !failed.some((item) => item.path === entry.path)
    ).length,
    plain: plan.entries.filter(
      (entry) =>
        entry.kind === 'plain' &&
        !failed.some((item) => item.path === entry.path)
    ).length,
    notDecrypted: plan.entries
      .filter((entry) => entry.kind === 'ciphertext')
      .map((entry) => entry.path),
    failed,
  })
  const text = (name: string, make: () => string): ArchiveInput => ({
    name,
    async *open() {
      yield encoder.encode(make())
    },
  })
  const fetched = (entry: ExportEntry): ArchiveInput => ({
    name: entry.path,
    date: new Date(entry.file.uploadedAt),
    // The size the server lists. The entry holds what the server sends.
    sizeHint: entry.file.sizeBytes,
    async open() {
      const response = await environment.fetch(fileUrls(entry.file).content, {
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok || !response.body) throw new ExportFetchError()
      return responseBytes(response)
    },
  })
  const decrypted = (entry: ExportEntry): ArchiveInput => ({
    name: entry.path,
    date: new Date(entry.file.uploadedAt),
    // What the stored length implies. The stream must give exactly this.
    size: plaintextLengthOf(entry.file.sizeBytes),
    async *open() {
      const source = openEncryptedSource({
        url: fileUrls(entry.file).content,
        fileKey: entry.opened!.fileKey,
        header: base64urlDecode(entry.file.encryption!.header!),
        storedLength: entry.file.sizeBytes,
        fetch: environment.fetch,
      })
      try {
        // The whole file is written, so its end must be proved first.
        await source.verifyEnd(signal)
        yield* source.stream(0, source.plaintextLength, {
          window: 'whole',
          signal,
        })
      } finally {
        source.close()
      }
    },
  })
  async function* inputs(): AsyncGenerator<ArchiveInput, void, undefined> {
    yield text('user-data.json', () => plan.userData)
    for (const entry of plan.entries) {
      signal.throwIfAborted()
      current = entry.path.split('/').at(-1) ?? ''
      yield entry.kind === 'decrypted' ? decrypted(entry) : fetched(entry)
    }
    current = ''
    yield text('export-report.json', () =>
      JSON.stringify(
        { exportedAt: new Date().toISOString(), ...summary() },
        null,
        2
      )
    )
  }
  let stored = 0
  const done = new Map<string, number>(
    plan.entries.map((entry) => [entry.path, entry.file.sizeBytes])
  )
  const archive = zipBytes(inputs(), {
    onEntry(entry) {
      const bytes = done.get(entry.name)
      if (bytes === undefined) return
      filesDone++
      stored += bytes
      report(stored)
    },
    onFailure(input, error) {
      // A cancelled export stops. Each other failure costs one entry.
      if (signal.aborted || !done.has(input.name)) return false
      failed.push({ path: input.name, reason: reasonOf(error) })
      filesDone++
      stored += done.get(input.name)!
      report(stored)
      return true
    },
  })
  return (async function* () {
    report(0)
    yield* archive
    environment.onDone?.(summary())
  })()
}

/** The name of the saved file, as the server export names it. */
export function exportFilename(now = Date.now()): string {
  return `flare-data-export-${now}.zip`
}

/**
 * The largest export that is held in memory, for a browser that can neither
 * write to a chosen file nor stream a download.
 */
export const EXPORT_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
