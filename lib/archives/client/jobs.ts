import {
  type EncryptedSource,
  type SourceFetch,
  openEncryptedSource,
  probeStoredLength,
} from '@/lib/e2ee/client/encrypted-source'
import { decodeStream } from '@/lib/e2ee/client/plain-view'
import { asFolderPublicKey } from '@/lib/e2ee/types'
import { BATCH_LIMIT } from '@/lib/library/contract'
import type {
  EncryptedStreamSource,
  EncryptedStreamUpload,
  UploadOptions,
} from '@/lib/uploads/client'

import type { IndexedEntry } from '../archive-index'
import { ArchiveError, truncatedArchive } from '../errors'
import { ManifestBuilder } from '../manifest'
import { ARCHIVE_LIMITS, type ArchiveOutputFormat } from '../shared'
import { type ArchiveInput, tarGzBytes, zipBytes } from './archive-writer'
import { EncryptedArchive, indexEncryptedArchive } from './encrypted-archive'

/**
 * Extracting and creating archives of encrypted files, in the browser
 * (docs/e2ee-spec.md, section 12.3). The data moves through the device as
 * streams: an entry is decrypted, decoded, encrypted again and uploaded
 * piece by piece. Run these in a worker: the cipher is JavaScript.
 *
 * The limits are the server's limits for plain archives. An archive is
 * attacker-controlled input, and an extraction makes one file for each
 * entry, so the counts and sizes stay bounded here too.
 */

/** An encrypted file a job reads: where its ciphertext is, and its key. */
export interface JobFile {
  readonly url: string
  readonly fileKey: Uint8Array
  readonly header: Uint8Array
  readonly storedLength?: number
  /** The decrypted name and type. Not trusted. */
  readonly name: string
  readonly type: string
}

/** A plain file a job reads from the server as it is. */
export interface PlainJobFile {
  readonly url: string
  readonly name: string
  readonly size: number
}

export type JobSource =
  | ({ readonly encrypted: true } & JobFile)
  | ({ readonly encrypted: false } & PlainJobFile)

/** Where new files go. The same options as an upload from the form. */
export type JobTarget = Pick<
  UploadOptions,
  'profileId' | 'folderId' | 'visibility' | 'expiresAt'
>

export interface JobProgress {
  readonly filesDone: number
  readonly filesTotal: number
  readonly bytesDone: number
  readonly bytesTotal: number
  /** The name being worked on. Shown to the person, never sent anywhere. */
  readonly current: string
}

export interface JobEnvironment {
  readonly fetch: SourceFetch
  readonly upload: (
    source: EncryptedStreamSource,
    options: UploadOptions & { encryptFor: Uint8Array },
    onProgress?: (bytes: number) => void
  ) => Promise<EncryptedStreamUpload>
  readonly accountPublicKey: Uint8Array
  readonly signal: AbortSignal
  readonly onProgress?: (progress: JobProgress) => void
}

/** A folder of an archive that an extraction makes as an account folder. */
export interface PlannedFolder {
  /** The path inside the archive, without a slash at either end. */
  readonly path: string
  readonly name: string
  /** The path of the folder above it. Empty: directly in the new folder. */
  readonly parentPath: string
}

/** An account folder that was made for an extraction. */
export interface ExtractionFolder {
  readonly id: string
  /**
   * `folder_public_key`, which the owner's browser got from the private key
   * it made (docs/e2ee-spec.md, section 8.4.2). A public file gets a folder
   * stanza for it. Null: the file is stored without one.
   */
  readonly folderPublicKey: Uint8Array | null
}

/**
 * Makes the folders of an extraction: one new folder that holds
 * everything, at the empty path, and one for each folder of the archive.
 * The owner's page does this, because a folder record needs the account
 * private key and the names must be sealed before they are sent (section
 * 12.3.1, rule 4). It is called once, after every check of the archive
 * passed and before the first upload.
 */
export type MakeExtractionFolders = (
  planned: readonly PlannedFolder[]
) => Promise<ReadonlyMap<string, ExtractionFolder>>

export interface ExtractResult {
  readonly fileCount: number
  readonly totalBytes: number
}

export interface CreateResult {
  readonly id: string
  /** The address of the new file, without the key. */
  readonly urlPath: string
  readonly name: string
  readonly records: EncryptedStreamUpload['records']
  /** The size of the archive before encryption. */
  readonly totalBytes: number
}

async function openSource(file: JobFile, environment: JobEnvironment) {
  const storedLength =
    file.storedLength ??
    (await probeStoredLength({
      url: file.url,
      header: file.header,
      fetch: environment.fetch,
      signal: environment.signal,
    }))
  return openEncryptedSource({
    url: file.url,
    fileKey: file.fileKey,
    header: file.header,
    storedLength,
    fetch: environment.fetch,
  })
}

const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
}

/**
 * The type a new file gets from its name. It is only a claim that is sealed
 * with the name: every viewer maps it to a safe renderer again.
 */
export function typeOfName(name: string): string {
  const extension = name.includes('.')
    ? name.split('.').at(-1)!.toLowerCase()
    : ''
  return TEXT_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * The folders of an archive, parents before the folders inside them, as the
 * server plans them for a plain archive. `nodes` is what a `ManifestBuilder`
 * collected: every folder that an entry names or lies in.
 */
export function plannedFolders(
  nodes: Iterable<{ readonly path: string; readonly type: string }>
): PlannedFolder[] {
  const folders: PlannedFolder[] = []
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    const parts = node.path.split('/')
    folders.push({
      path: node.path,
      name: parts[parts.length - 1],
      parentPath: parts.slice(0, -1).join('/'),
    })
  }
  return folders.sort(
    (left, right) =>
      left.path.split('/').length - right.path.split('/').length ||
      left.path.localeCompare(right.path)
  )
}

/**
 * Reads entries of a decoded stream in the order they are stored, in one
 * pass: a TAR.GZ has no way to jump to an entry.
 */
function sequentialReader(
  decoded: AsyncGenerator<Uint8Array, void, undefined>
) {
  let position = 0
  let held: Uint8Array | null = null
  async function* take(length: number) {
    let remaining = length
    while (remaining > 0) {
      if (!held) {
        const step = await decoded.next()
        if (step.done) throw truncatedArchive()
        held = step.value
      }
      const count = Math.min(held.length, remaining)
      const piece = held.subarray(0, count)
      held = count < held.length ? held.subarray(count) : null
      remaining -= count
      position += count
      yield piece
    }
  }
  return {
    async bytes(offset: number, length: number) {
      if (offset < position)
        throw new ArchiveError('The archive entries are out of order.')
      for await (const _skipped of take(offset - position)) void _skipped
      return take(length)
    },
    close: () => decoded.return(undefined),
  }
}

/**
 * Extracts every file of an encrypted archive as a new encrypted file, in
 * the folder structure of the archive: a new folder holds everything, as
 * the server makes one for a plain archive. `target.folderId` is where that
 * new folder goes and is not where the files go.
 */
export async function extractEncryptedArchive(
  file: JobFile,
  target: JobTarget,
  environment: JobEnvironment & { readonly folders: MakeExtractionFolders }
): Promise<ExtractResult> {
  const { signal } = environment
  const source = await openSource(file, environment)
  try {
    const index = await indexEncryptedArchive({
      source,
      name: file.name,
      type: file.type,
      signal,
    })
    const { extraction } = index.listing()
    if (!extraction.available) throw new ArchiveError(extraction.reason, 413)
    // The same strict rules as the server: paths, counts, sizes, clashes.
    const builder = new ManifestBuilder()
    const files: { entry: IndexedEntry; position: number; path: string }[] = []
    index.entries.forEach((entry, position) => {
      const accepted = builder.add(entry.path, entry.type, entry.size)
      if (accepted && entry.type === 'file')
        files.push({ entry, position, path: accepted.path })
    })
    const archive = new EncryptedArchive(source, index)
    const sequential =
      index.format === 'tar.gz' || index.format === 'gzip'
        ? sequentialReader(
            decodeStream(
              source.stream(0, source.plaintextLength, {
                window: 'whole',
                signal,
              }),
              'gzip'
            )
          )
        : null
    // Every check of the archive passed. Nothing was made before this.
    signal.throwIfAborted()
    const folders = await environment.folders(
      plannedFolders(builder.nodes.values())
    )
    let bytesDone = 0
    let filesDone = 0
    try {
      for (const { entry, position, path } of files) {
        signal.throwIfAborted()
        const parts = path.split('/')
        const name = parts[parts.length - 1]
        const folder = folders.get(parts.slice(0, -1).join('/'))
        if (!folder)
          throw new ArchiveError('A folder of the archive was not made.', 500)
        const report = (current: number) =>
          environment.onProgress?.({
            filesDone,
            filesTotal: files.length,
            bytesDone: bytesDone + current,
            bytesTotal: builder.totalBytes,
            current: name,
          })
        report(0)
        const bytes = sequential
          ? await sequential.bytes(entry.offset, entry.size)
          : await archive.stream(position, { signal, window: 'whole' })
        await environment.upload(
          { name, type: typeOfName(name), size: entry.size, bytes },
          {
            ...target,
            folderId: folder.id,
            // A file that is public by this request gets its folder stanza
            // now. Where a profile decides, the background work of the
            // owner's browser makes it (sections 8.4.3 and 9.4.7).
            library: {
              folder: folder.folderPublicKey && {
                folderPublicKey: asFolderPublicKey(folder.folderPublicKey),
              },
            },
            encryptFor: environment.accountPublicKey,
            signal,
          },
          report
        )
        bytesDone += entry.size
        filesDone++
      }
    } finally {
      await sequential?.close().catch(() => undefined)
    }
    environment.onProgress?.({
      filesDone,
      filesTotal: files.length,
      bytesDone,
      bytesTotal: builder.totalBytes,
      current: '',
    })
    return { fileCount: files.length, totalBytes: builder.totalBytes }
  } finally {
    source.close()
  }
}

function baseName(name: string) {
  return name.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? ''
}

/** Member names as the server makes them: one segment, cleaned, numbered on a clash. */
export function memberNames(names: readonly string[]): string[] {
  const used = new Set<string>()
  return names.map((original) => {
    let name = baseName(original.normalize('NFKC'))
      .replace(/[\p{Cc}\p{Cf}�]/gu, '')
      .replace(/:/g, '-')
      .trim()
    if (!name || name === '.' || name === '..') name = 'file'
    name = Array.from(name).slice(0, 180).join('')
    while (name.length > 180) name = Array.from(name).slice(0, -1).join('')
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot) : ''
    const stem = name.slice(0, name.length - extension.length)
    let candidate = name
    for (let index = 2; used.has(candidate.toLowerCase()); index++)
      candidate = `${stem} (${index})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
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

/** The size of a stored file, from the answer to a request for its first byte. */
async function storedSize(
  url: string,
  environment: JobEnvironment
): Promise<number> {
  const response = await environment.fetch(url, {
    headers: { Range: 'bytes=0-0' },
    signal: environment.signal,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  void response.body?.cancel().catch(() => undefined)
  // An empty file has no first byte: the server answers 416 with its size.
  const total = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
  if (![206, 416].includes(response.status) || !total)
    throw new ArchiveError('One or more source files are unavailable.', 404)
  return Number(total[1])
}

/**
 * Builds a ZIP or TAR.GZ from files of the account and uploads it as a new
 * encrypted file. Encrypted sources are decrypted here; plain sources are
 * read from the server as they are.
 */
export async function createEncryptedArchive(
  sources: readonly JobSource[],
  output: { readonly name: string; readonly format: ArchiveOutputFormat },
  target: JobTarget,
  environment: JobEnvironment
): Promise<CreateResult> {
  const { signal } = environment
  if (!sources.length || sources.length > BATCH_LIMIT)
    throw new ArchiveError(`Select between 1 and ${BATCH_LIMIT} files.`)
  const opened: EncryptedSource[] = []
  try {
    const names = memberNames(sources.map((file) => file.name))
    const builder = new ManifestBuilder()
    const inputs: ArchiveInput[] = []
    for (const [index, file] of sources.entries()) {
      signal.throwIfAborted()
      if (file.encrypted) {
        const source = await openSource(file, environment)
        opened.push(source)
        // The whole file goes into the archive, so its end must be proved.
        await source.verifyEnd(signal)
        builder.add(names[index], 'file', source.plaintextLength)
        inputs.push({
          name: names[index],
          size: source.plaintextLength,
          open: () =>
            source.stream(0, source.plaintextLength, {
              window: 'whole',
              signal,
            }),
        })
      } else {
        // The exact size, which a TAR header needs: the total the server
        // names for the stored file. The library lists sizes in megabytes.
        const size = await storedSize(file.url, environment)
        builder.add(names[index], 'file', size)
        inputs.push({
          name: names[index],
          size,
          async open() {
            const response = await environment.fetch(file.url, {
              signal,
              credentials: 'same-origin',
              cache: 'no-store',
            })
            if (!response.ok || !response.body)
              throw new ArchiveError(
                'One or more source files are unavailable.',
                404
              )
            return responseBytes(response)
          },
        })
      }
    }
    let written = 0
    let filesDone = 0
    const report = (bytesDone: number) =>
      environment.onProgress?.({
        filesDone,
        filesTotal: inputs.length,
        bytesDone,
        bytesTotal: builder.totalBytes,
        current: names[Math.min(filesDone, names.length - 1)],
      })
    const options = {
      onProgress: report,
      onEntry: () => {
        filesDone++
      },
    }
    const archive =
      output.format === 'zip'
        ? zipBytes(inputs, options)
        : tarGzBytes(inputs, options)
    async function* limited() {
      for await (const piece of archive) {
        written += piece.length
        if (written > ARCHIVE_LIMITS.archiveBytes)
          throw new ArchiveError('The generated archive exceeds 256 MiB.', 413)
        yield piece
      }
    }
    report(0)
    const uploaded = await environment.upload(
      {
        name: output.name,
        type: output.format === 'zip' ? 'application/zip' : 'application/gzip',
        bytes: limited(),
      },
      { ...target, encryptFor: environment.accountPublicKey, signal }
    )
    return {
      id: uploaded.id,
      urlPath: new URL(uploaded.url).pathname,
      name: output.name,
      records: uploaded.records,
      totalBytes: written,
    }
  } finally {
    for (const source of opened) source.close()
  }
}
