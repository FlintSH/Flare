import { useEffect, useState } from 'react'

import {
  EncryptedArchive,
  entryMediaType,
  indexEncryptedArchive,
} from '@/lib/archives/client/encrypted-archive'
import type { JobFile } from '@/lib/archives/client/jobs'
import type {
  ArchiveListing,
  ArchiveListingProgress,
} from '@/lib/archives/shared'
import {
  type EncryptedSource,
  openEncryptedSource,
  probeStoredLength,
} from '@/lib/e2ee/client/encrypted-source'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import {
  type LocalAddress,
  type LocalAddresses,
  localAddresses,
} from '@/lib/e2ee/client/local-address'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import {
  downloadDecrypted,
  saveDecrypted,
  saveLocalAddress,
} from '@/lib/files/encrypted-client'
import { DOWNLOAD_BLOB_TYPE, safeFileName } from '@/lib/files/safe-render'
import { fileUrls } from '@/lib/files/urls'

/**
 * An encrypted archive that this page opened (docs/e2ee-spec.md, section
 * 12.3). The page reads the index and the text of entries itself. Images,
 * video and audio of entries play from local addresses of the service
 * worker where there is one, and from Blobs of bounded size where there is
 * none. Nothing here asks the server for an entry: it has only ciphertext.
 */
export interface EncryptedArchiveFile {
  readonly id: string
  readonly urlPath: string
  /** The 26-byte header, base64url, as the records carry it. */
  readonly header: string
  /** The size of the ciphertext in bytes, where the page knows it. */
  readonly sizeBytes?: number
  readonly opened: Pick<OpenedFile, 'fileKey' | 'name' | 'type'>
}

/** The largest entry loaded into memory when no service worker can stream it. */
export const ENTRY_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024

const pageFetch = (url: string, init: RequestInit) => fetch(url, init)

export class EncryptedArchiveHandle {
  private source: EncryptedSource | null = null
  private archive: EncryptedArchive | null = null
  private service: LocalAddresses | null = null
  private readonly addresses = new Map<number, LocalAddress>()
  private readonly blobs = new Map<number, Promise<string>>()
  private readonly lifetime = new AbortController()
  private storedLength: number | undefined
  private readonly url: string
  private readonly header: Uint8Array

  constructor(readonly file: EncryptedArchiveFile) {
    this.url = fileUrls(file).content
    this.header = base64urlDecode(file.header)
    this.storedLength = file.sizeBytes
  }

  /** Whether entries can play from local addresses. Known after `load`. */
  get streams(): boolean {
    return this.service !== null
  }

  /** Reads the index. Entries found so far arrive through `onUpdate`. */
  async load(options: {
    signal: AbortSignal
    onUpdate: (progress: ArchiveListingProgress) => void
  }): Promise<ArchiveListing> {
    if (this.archive) return this.archive.listing()
    this.storedLength ??= await probeStoredLength({
      url: this.url,
      header: this.header,
      fetch: pageFetch,
      signal: options.signal,
    })
    const source = openEncryptedSource({
      url: this.url,
      fileKey: this.file.opened.fileKey,
      header: this.header,
      storedLength: this.storedLength,
      fetch: pageFetch,
    })
    try {
      const [index, service] = await Promise.all([
        indexEncryptedArchive({
          source,
          name: this.file.opened.name,
          type: this.file.opened.type,
          signal: options.signal,
          onProgress: (found) => options.onUpdate(found.progress()),
        }),
        localAddresses(),
      ])
      if (this.lifetime.signal.aborted) throw this.lifetime.signal.reason
      this.source = source
      this.service = service
      this.archive = new EncryptedArchive(source, index)
      return this.archive.listing()
    } catch (error) {
      source.close()
      throw error
    }
  }

  private opened(): EncryptedArchive {
    if (!this.archive) throw new Error('The archive is not open')
    return this.archive
  }

  private address(
    position: number,
    mode: 'media' | 'download',
    contentType: string
  ): LocalAddress | null {
    if (!this.service) return null
    const archive = this.opened()
    return this.service.create({
      mode,
      contentType,
      filename: archive.entry(position).path.split('/').at(-1),
      source: {
        kind: 'file',
        url: this.url,
        fileKey: this.file.opened.fileKey,
        header: this.header,
        storedLength: this.storedLength,
        member: archive.member(position),
      },
    })
  }

  /**
   * The local address an `<img>`, `<video>` or `<audio>` shows the entry
   * from, or null: no service worker, an entry with a problem, or a name
   * that is not on the list of media types.
   */
  mediaUrl(position: number): string | null {
    const known = this.addresses.get(position)
    if (known) return known.url
    if (!this.service || !this.archive) return null
    const entry = this.archive.index.entries[position]
    const type = entry && !entry.issue ? entryMediaType(entry.path) : null
    if (!type) return null
    const address = this.address(position, 'media', type)
    if (!address) return null
    this.addresses.set(position, address)
    return address.url
  }

  /** Gives the address of an entry to the worker again, after a failed request. */
  async refresh(position: number): Promise<boolean> {
    return (
      (await this.addresses
        .get(position)
        ?.refresh()
        .then(
          () => true,
          () => false
        )) ?? false
    )
  }

  /** The bytes `[start, end)` of an entry, decrypted and decoded here. */
  read(
    position: number,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    return this.opened().read(position, start, end, signal)
  }

  /**
   * The entry as a Blob address of its fixed media type, for a browser
   * without a service worker. Rejects with a `RangeError` for an entry
   * larger than `maxBytes`.
   */
  blobUrl(position: number, maxBytes: number): Promise<string> {
    let known = this.blobs.get(position)
    if (!known) {
      known = (async () => {
        const entry = this.opened().entry(position)
        const type = entryMediaType(entry.path)
        if (!type) throw new Error('This entry has no preview')
        if (entry.size > maxBytes)
          throw new RangeError('The entry is too large')
        const bytes = await this.read(
          position,
          0,
          entry.size,
          this.lifetime.signal
        )
        return URL.createObjectURL(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
        )
      })()
      known.catch(() => this.blobs.delete(position))
      this.blobs.set(position, known)
    }
    return known
  }

  /** Saves one entry to disk under its own name. */
  async download(position: number): Promise<void> {
    const entry = this.opened().entry(position)
    const name = safeFileName(entry.path.split('/').at(-1))
    const address = this.address(position, 'download', DOWNLOAD_BLOB_TYPE)
    if (address) {
      const result = await saveLocalAddress(address, {
        signal: this.lifetime.signal,
      })
      if (result !== 'unavailable') return
    }
    if (entry.size > ENTRY_MEMORY_LIMIT_BYTES)
      throw new RangeError('The entry is too large')
    const bytes = await this.read(position, 0, entry.size, this.lifetime.signal)
    saveDecrypted(
      { parts: [bytes as Uint8Array<ArrayBuffer>], length: bytes.length },
      name
    )
  }

  /** Saves the whole archive to disk. */
  downloadArchive(): Promise<void> {
    return downloadDecrypted(
      {
        id: this.file.id,
        urlPath: this.file.urlPath,
        header: this.file.header,
        sizeBytes: this.storedLength,
      },
      this.file.opened,
      { signal: this.lifetime.signal }
    )
  }

  /** What the archive worker needs to extract this archive. */
  jobFile(): JobFile {
    return {
      url: this.url,
      fileKey: this.file.opened.fileKey,
      header: this.header,
      storedLength: this.storedLength,
      name: this.file.opened.name,
      type: this.file.opened.type,
    }
  }

  /** Releases every address and Blob, and erases the keys of the reader. */
  dispose() {
    this.lifetime.abort(new DOMException('Closed', 'AbortError'))
    for (const address of this.addresses.values()) address.release()
    this.addresses.clear()
    for (const blob of this.blobs.values())
      void blob.then(
        (url) => URL.revokeObjectURL(url),
        () => undefined
      )
    this.blobs.clear()
    this.source?.close()
    this.source = null
    this.archive = null
  }
}

/**
 * The handle of an encrypted archive for as long as a component shows it.
 * Null until the file is known, and for a plain file.
 */
export function useEncryptedArchive(
  file: EncryptedArchiveFile | null
): EncryptedArchiveHandle | null {
  const [handle, setHandle] = useState<EncryptedArchiveHandle | null>(null)
  const id = file?.id
  const key = file?.opened.fileKey
  useEffect(() => {
    if (!file) {
      setHandle(null)
      return
    }
    const next = new EncryptedArchiveHandle(file)
    setHandle(next)
    return () => next.dispose()
    // The file is the same while its ID and key are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key])
  return handle
}
