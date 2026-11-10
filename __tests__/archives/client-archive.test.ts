import archiver from 'archiver'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync, gunzipSync, gzipSync } from 'node:zlib'
import * as tar from 'tar-stream'
import { describe, expect, it } from 'vitest'

import {
  type ArchiveInput,
  tarBytes,
  tarGzBytes,
  zipBytes,
} from '@/lib/archives/client/archive-writer'
import {
  CLIENT_ARCHIVE_LIMITS,
  EncryptedArchive,
  entryMediaType,
  indexEncryptedArchive,
} from '@/lib/archives/client/encrypted-archive'
import {
  type JobEnvironment,
  type JobFile,
  createEncryptedArchive,
  extractEncryptedArchive,
  extractedName,
  memberNames,
  typeOfName,
} from '@/lib/archives/client/jobs'
import { readArchive } from '@/lib/archives/codec'
import { crc32 as browserCrc32 } from '@/lib/archives/crc32'
import { ARCHIVE_LIMITS } from '@/lib/archives/shared'
import { openEncryptedSource } from '@/lib/e2ee/client/encrypted-source'
import { STORED_CHUNK_SIZE } from '@/lib/e2ee/file'
import type { EncryptedStreamSource } from '@/lib/uploads/client'

import {
  encrypted,
  expectSameBytes,
  fakeServer,
  fileKey,
  header,
} from '../e2ee/sw/support'
import { collect } from '../e2ee/test-support'

const URL = '/api/files/alexm/e_AAAAAAAAAAAAAAAAAAAAAA'

async function sourceOf(archive: Uint8Array) {
  const stored = await encrypted(archive)
  const server = fakeServer({ [URL]: stored })
  const source = openEncryptedSource({
    url: URL,
    fileKey,
    header,
    storedLength: stored.length,
    fetch: server.fetch,
  })
  return { source, server, stored }
}

async function opened(archive: Uint8Array, name: string) {
  const { source, server, stored } = await sourceOf(archive)
  const index = await indexEncryptedArchive({
    source,
    name,
    signal: new AbortController().signal,
  })
  return { archive: new EncryptedArchive(source, index), index, server, stored }
}

function input(name: string, data: Uint8Array | string): ArchiveInput {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data
  return {
    name,
    size: bytes.length,
    date: new Date('2026-03-04T05:06:08Z'),
    async *open() {
      // In pieces, as a decrypted file arrives.
      for (let offset = 0; offset < bytes.length; offset += 40_000)
        yield bytes.subarray(offset, offset + 40_000)
    },
  }
}

/** Hand-written ZIP for names and sizes that real writers refuse to produce. */
function rawZip(
  items: {
    name: string
    data: Buffer
    method?: number
    crc?: number
    size?: number
    /** Deflated bytes made before, for `data` too large to make again. */
    deflated?: Buffer
  }[]
) {
  const contents: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const name = Buffer.from(item.name)
    const stored =
      item.deflated ??
      (item.method === 8 ? deflateRawSync(item.data) : item.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(item.method ?? 0, 8)
    local.writeUInt32LE(item.crc ?? crc32(item.data), 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(item.size ?? item.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    local.copy(central, 6, 4, 28)
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    contents.push(local, name, stored)
    directory.push(central, name)
    offset += 30 + name.length + stored.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...contents, central, end])
}

async function archiverZip(
  files: { name: string; data: Buffer; store?: boolean }[]
) {
  const archive = archiver('zip')
  const chunks: Buffer[] = []
  const collecting = (async () => {
    for await (const chunk of archive) chunks.push(Buffer.from(chunk))
  })()
  for (const file of files)
    archive.append(file.data, { name: file.name, store: file.store })
  await archive.finalize()
  await collecting
  return Buffer.concat(chunks)
}

async function tarStream(entries: { name: string; data: Buffer }[]) {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  const consuming = (async () => {
    for await (const chunk of pack)
      chunks.push(Buffer.from(chunk as Uint8Array))
  })()
  for (const entry of entries) pack.entry({ name: entry.name }, entry.data)
  pack.finalize()
  await consuming
  return Buffer.concat(chunks)
}

function fetched(server: { requests: { bytes: number }[] }) {
  return server.requests.reduce((sum, request) => sum + request.bytes, 0)
}

describe('CRC-32 without node:zlib', () => {
  it('gives the same value as zlib, also when it continues over pieces', () => {
    const data = randomBytes(100_000)
    expect(browserCrc32(data)).toBe(crc32(data))
    expect(
      browserCrc32(
        data.subarray(70_000),
        browserCrc32(data.subarray(0, 70_000))
      )
    ).toBe(crc32(data))
    expect(browserCrc32(new Uint8Array(0))).toBe(0)
  })
})

describe('listing an encrypted ZIP', () => {
  it('reads only the end of the file to list it, and only an entry to open it', async () => {
    const big = randomBytes(6 * 1024 * 1024)
    const small = Buffer.from('the small entry\n')
    const zip = await archiverZip([
      { name: 'media/clip.bin', data: big, store: true },
      {
        name: 'media/more.bin',
        data: randomBytes(5 * 1024 * 1024),
        store: true,
      },
      { name: 'notes/readme.txt', data: small },
    ])
    const { archive, server, stored } = await opened(zip, 'bundle.zip')
    const listing = archive.listing()
    expect(listing.format).toBe('zip')
    expect(listing.entries.map((entry) => entry.path)).toEqual([
      'media/clip.bin',
      'media/more.bin',
      'notes/readme.txt',
    ])
    expect(listing.fileCount).toBe(3)
    expect(listing.extraction).toEqual({ available: true })
    // The final chunk (the proof of the length) and the chunks with the
    // directory: far less than the 11 MiB archive.
    expect(fetched(server)).toBeLessThan(6 * STORED_CHUNK_SIZE)
    expect(fetched(server)).toBeLessThan(stored.length / 20)

    server.requests.length = 0
    const text = await archive.read(2, 0, small.length)
    expect(Buffer.from(text).toString()).toBe('the small entry\n')
    expect(fetched(server)).toBeLessThan(6 * STORED_CHUNK_SIZE)

    // A range of a stored entry reads the chunks of that range.
    server.requests.length = 0
    expectSameBytes(
      await archive.read(0, 3_000_000, 3_000_100),
      big.subarray(3_000_000, 3_000_100)
    )
    expect(fetched(server)).toBeLessThanOrEqual(5 * STORED_CHUNK_SIZE)
  })

  it('inflates a deflated entry and checks its CRC-32 on a whole read', async () => {
    const data = Buffer.from('line of text\n'.repeat(20_000))
    const zip = await archiverZip([{ name: 'log.txt', data }])
    const { archive } = await opened(zip, 'log.zip')
    expectSameBytes(await collect(await archive.stream(0)), data)
    expectSameBytes(await archive.read(0, 13, 26), data.subarray(13, 26))

    const wrong = rawZip([{ name: 'log.txt', data, method: 8, crc: 12345 }])
    const damaged = await opened(wrong, 'log.zip')
    await expect(collect(await damaged.archive.stream(0))).rejects.toThrow(
      /damaged/
    )
  })

  it('stops an entry that inflates to more than it declared', async () => {
    const data = Buffer.alloc(200_000, 7)
    const zip = rawZip([{ name: 'lie.bin', data, method: 8, size: 1000 }])
    const { archive } = await opened(zip, 'lie.zip')
    await expect(collect(await archive.stream(0))).rejects.toThrow(/damaged/)
  })

  it('flags an entry whose declared size no deflate stream can reach', async () => {
    // 1 KiB of compressed data that claims 1 GiB: over the 1032:1 bound.
    const zip = rawZip([
      {
        name: 'bomb.bin',
        data: Buffer.alloc(1024, 1),
        method: 8,
        size: 1024 ** 3,
      },
    ])
    const { archive } = await opened(zip, 'bomb.zip')
    const listing = archive.listing()
    expect(listing.entries[0].issue).toBe('damaged')
    expect(listing.extraction.available).toBe(false)
    await expect(archive.stream(0)).rejects.toThrow(/damaged/)
  })

  it('refuses a local header that names a different method than the directory', async () => {
    const zip = rawZip([{ name: 'a.txt', data: Buffer.from('hello') }])
    // The local header now says "deflated"; the directory says "stored".
    zip.writeUInt16LE(8, 8)
    const { archive } = await opened(zip, 'a.zip')
    await expect(collect(await archive.stream(0))).rejects.toThrow(/damaged/)
  })

  it('does not list a file that is not a ZIP', async () => {
    const { source } = await sourceOf(randomBytes(5000))
    await expect(
      indexEncryptedArchive({
        source,
        name: 'not.zip',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/file list|ZIP/)
  })

  it('does not list an archive whose stored length is not its end', async () => {
    const zip = await archiverZip([
      { name: 'a.bin', data: randomBytes(300_000), store: true },
    ])
    const stored = await encrypted(zip)
    const cut = stored.slice(0, 26 + 2 * STORED_CHUNK_SIZE)
    const server = fakeServer({ [URL]: cut })
    const source = openEncryptedSource({
      url: URL,
      fileKey,
      header,
      storedLength: cut.length,
      fetch: server.fetch,
    })
    await expect(
      indexEncryptedArchive({
        source,
        name: 'a.zip',
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ name: 'E2eeError' })
  })
})

describe('hostile entry names', () => {
  const names = [
    '../../etc/passwd',
    '/absolute/path.txt',
    'C:\\Windows\\system32\\evil.dll',
    'a/../../escape.txt',
    'dir//double.txt',
    'ok/./dot.txt',
    'bidi/\u202Egpj.exe',
    'control/\u0007bell.txt',
    '<img src=x onerror=alert(1)>.txt',
  ]

  it('lists them cleaned and flagged, serves none of the unsafe ones, and refuses to extract', async () => {
    const zip = rawZip(names.map((name) => ({ name, data: Buffer.from('x') })))
    const { archive } = await opened(zip, 'hostile.zip')
    const listing = archive.listing()
    const byPath = new Map(listing.entries.map((entry) => [entry.path, entry]))
    // No listed path can leave the archive or carry a control character.
    for (const entry of listing.entries) {
      expect(entry.path.startsWith('/')).toBe(false)
      expect(entry.path).not.toMatch(/^[a-z]:/i)
      expect(entry.path.includes('\\')).toBe(false)
      expect(entry.path).not.toMatch(/[\p{Cc}\p{Cf}]/u)
    }
    for (const path of [
      '../../etc/passwd',
      'absolute/path.txt',
      'Windows/system32/evil.dll',
      'a/../../escape.txt',
      'dir/double.txt',
      'ok/dot.txt',
    ])
      expect(byPath.get(path)?.issue, path).toBe('unsafe-path')
    // A character that reorders or hides text is shown as U+FFFD. The
    // extraction rules refuse such a name.
    expect(byPath.has('bidi/\uFFFDgpj.exe')).toBe(true)
    expect(byPath.has('control/\uFFFDbell.txt')).toBe(true)
    // Markup in a name is text. It is listed, and it is not unsafe to read.
    expect(
      byPath.get('<img src=x onerror=alert(1)>.txt')?.issue
    ).toBeUndefined()
    expect(listing.extraction.available).toBe(false)
    const unsafe = listing.entries.findIndex((entry) => entry.issue)
    await expect(archive.stream(unsafe)).rejects.toThrow(/unsafe/)
  })

  it('never shows an entry as HTML, SVG or script, whatever its name says', () => {
    for (const path of [
      'page.html',
      'page.htm',
      'vector.svg',
      'doc.xhtml',
      'feed.xml',
      'app.js',
      'report.pdf',
      'movie.mkv',
      'noextension',
      'trick.png.html',
    ])
      expect(entryMediaType(path), path).toBeNull()
    expect(entryMediaType('a/b/photo.JPG')).toBe('image/jpeg')
    expect(entryMediaType('clip.webm')).toBe('video/webm')
    expect(entryMediaType('song.mp3')).toBe('audio/mpeg')
    expect(entryMediaType('trick.html.png')).toBe('image/png')
  })
})

describe('the limits of extraction', () => {
  const noUpload: JobEnvironment['upload'] = async () => {
    throw new Error('Nothing may be uploaded')
  }
  async function extractOf(zip: Uint8Array, name = 'archive.zip') {
    const { server, stored } = await sourceOf(zip)
    const file: JobFile = {
      url: URL,
      fileKey,
      header,
      storedLength: stored.length,
      name,
      type: 'application/zip',
    }
    return extractEncryptedArchive(
      file,
      { folderId: null, profileId: null },
      {
        fetch: server.fetch,
        upload: noUpload,
        accountPublicKey: new Uint8Array(32),
        signal: new AbortController().signal,
      }
    )
  }

  it('refuses more than 1,000 entries before it uploads anything', async () => {
    const zip = rawZip(
      Array.from({ length: ARCHIVE_LIMITS.entries + 1 }, (_, index) => ({
        name: `file-${index}.txt`,
        data: Buffer.from('x'),
      }))
    )
    await expect(extractOf(zip)).rejects.toThrow(/more than 1,000/)
  })

  it('refuses paths more than 20 levels deep', async () => {
    const deep = `${Array.from({ length: 21 }, (_, index) => `d${index}`).join('/')}/f.txt`
    await expect(
      extractOf(rawZip([{ name: deep, data: Buffer.from('x') }]))
    ).rejects.toThrow(/20 levels deep/)
  })

  // Real deflate streams of zeros: a few hundred KiB that inflate to
  // hundreds of MiB. The rules read the declared sizes and inflate nothing.
  const zeros = (mib: number) => {
    const data = Buffer.alloc(mib * 1024 ** 2)
    return {
      size: data.length,
      crc: crc32(data),
      deflated: deflateRawSync(data),
    }
  }

  it('refuses an archive that unpacks to more than 512 MiB', async () => {
    const part = zeros(200)
    expect(part.deflated.length).toBeLessThan(1024 ** 2)
    const zip = rawZip(
      [1, 2, 3].map((index) => ({
        name: `big-${index}.bin`,
        data: Buffer.alloc(0),
        method: 8,
        ...part,
      }))
    )
    await expect(extractOf(zip)).rejects.toThrow(
      /unpacks to 600 MB, more than the 512 MB extraction limit/
    )
  })

  it('refuses a file larger than 256 MiB, by its declared size', async () => {
    const zip = rawZip([
      { name: 'huge.bin', data: Buffer.alloc(0), method: 8, ...zeros(257) },
    ])
    await expect(extractOf(zip)).rejects.toThrow(
      /huge\.bin is 257 MB, larger than the 256 MB limit for one file/
    )
  })

  it('refuses a name that hides or reorders its text', async () => {
    await expect(
      extractOf(
        rawZip([{ name: 'bidi/\u202Egpj.exe', data: Buffer.from('x') }])
      )
    ).rejects.toThrow(/unsafe|filename/)
  })

  it('refuses names that clash when letter case is ignored', async () => {
    const zip = rawZip([
      { name: 'Report.txt', data: Buffer.from('a') },
      { name: 'report.txt', data: Buffer.from('b') },
    ])
    await expect(extractOf(zip)).rejects.toThrow(/duplicate or conflicting/)
  })

  it('refuses unsafe paths', async () => {
    await expect(
      extractOf(rawZip([{ name: '../up.txt', data: Buffer.from('x') }]))
    ).rejects.toThrow(/unsafe paths/)
  })
})

describe('extracting an encrypted archive', () => {
  function collector() {
    const uploads: {
      name: string
      type: string
      size?: number
      bytes: Uint8Array
      options: Record<string, unknown>
    }[] = []
    const upload: JobEnvironment['upload'] = async (
      source,
      options,
      onProgress
    ) => {
      const bytes = await collect(source.bytes as AsyncIterable<Uint8Array>)
      onProgress?.(bytes.length)
      uploads.push({
        name: source.name,
        type: source.type,
        size: source.size,
        bytes,
        options: options as unknown as Record<string, unknown>,
      })
      return {
        id: `id-${uploads.length}`,
        url: 'https://flare.example/alexm/e_x#k',
        name: source.name,
        size: bytes.length,
        type: source.type,
        records: {
          header: '',
          sealedMetadata: '',
          accountStanza: '',
          stanzaAccountPublicKey: '',
        },
      }
    }
    return { uploads, upload }
  }

  const files = [
    { name: 'photos/2026/harbor.png', data: randomBytes(150_000) },
    { name: 'photos/2026/pier.jpg', data: randomBytes(90_000) },
    { name: 'notes.txt', data: Buffer.from('plain notes\n'.repeat(3000)) },
    { name: 'empty.bin', data: Buffer.alloc(0) },
  ]

  async function run(archive: Uint8Array, name: string) {
    const { server, stored } = await sourceOf(archive)
    const { uploads, upload } = collector()
    const progress: number[] = []
    const result = await extractEncryptedArchive(
      {
        url: URL,
        fileKey,
        header,
        storedLength: stored.length,
        name,
        type: 'application/octet-stream',
      },
      { folderId: 'folder-1', profileId: null, visibility: 'PRIVATE' },
      {
        fetch: server.fetch,
        upload,
        accountPublicKey: new Uint8Array(32).fill(5),
        signal: new AbortController().signal,
        onProgress: (event) => progress.push(event.bytesDone),
      }
    )
    return { result, uploads, progress, server }
  }

  it.each([
    ['ZIP', 'bundle.zip', () => archiverZip(files)],
    ['TAR', 'bundle.tar', () => tarStream(files)],
    ['TAR.GZ', 'bundle.tar.gz', async () => gzipSync(await tarStream(files))],
    ['TGZ', 'bundle.tgz', async () => gzipSync(await tarStream(files))],
  ])('makes one file for each entry of a %s', async (_format, name, make) => {
    const { result, uploads, progress } = await run(await make(), name)
    expect(result.fileCount).toBe(4)
    expect(result.totalBytes).toBe(
      files.reduce((sum, file) => sum + file.data.length, 0)
    )
    expect(uploads.map((upload) => upload.name)).toEqual([
      'photos - 2026 - harbor.png',
      'photos - 2026 - pier.jpg',
      'notes.txt',
      'empty.bin',
    ])
    expect(uploads.map((upload) => upload.type)).toEqual([
      'image/png',
      'image/jpeg',
      'text/plain',
      'application/octet-stream',
    ])
    for (const [index, file] of files.entries()) {
      expectSameBytes(uploads[index].bytes, file.data)
      expect(uploads[index].size).toBe(file.data.length)
      expect(uploads[index].options).toMatchObject({
        folderId: 'folder-1',
        profileId: null,
        visibility: 'PRIVATE',
      })
    }
    expect(progress.at(-1)).toBe(result.totalBytes)
  })

  it('extracts the one file of a GZIP under the name without .gz', async () => {
    const data = Buffer.from('a log line\n'.repeat(5000))
    const { result, uploads } = await run(gzipSync(data), 'server.log.gz')
    expect(result.fileCount).toBe(1)
    expect(uploads[0].name).toBe('server.log')
    expectSameBytes(uploads[0].bytes, data)
  })

  it('reads a TAR.GZ in one pass, not one pass for each entry', async () => {
    const { server } = await run(
      gzipSync(await tarStream(files)),
      'bundle.tar.gz'
    )
    // The final chunk, one pass to list, one pass to extract.
    expect(server.requests.length).toBeLessThanOrEqual(3)
  })
})

describe('listing and opening other formats', () => {
  it('lists a TAR from its headers and reads an entry as a range of the file', async () => {
    const first = randomBytes(4 * 1024 * 1024)
    const second = Buffer.from('second entry')
    const archive = await tarStream([
      { name: 'a/first.bin', data: first },
      { name: 'a/second.txt', data: second },
    ])
    const {
      archive: openedArchive,
      server,
      stored,
    } = await opened(archive, 'x.tar')
    expect(openedArchive.listing().entries.map((entry) => entry.path)).toEqual([
      'a/first.bin',
      'a/second.txt',
    ])
    // Headers only: the 4 MiB of the first entry are skipped.
    expect(fetched(server)).toBeLessThan(stored.length / 4)
    expect(Buffer.from(await openedArchive.read(1, 0, 100)).toString()).toBe(
      'second entry'
    )
  })

  it('lists a TAR.GZ and opens an entry by decoding up to it', async () => {
    const data = Buffer.from('inside the compressed tar\n'.repeat(100))
    const archive = gzipSync(
      await tarStream([
        { name: 'pad.bin', data: randomBytes(300_000) },
        { name: 'deep/file.txt', data },
      ])
    )
    const { archive: openedArchive } = await opened(archive, 'x.tar.gz')
    expect(openedArchive.format).toBe('tar.gz')
    expectSameBytes(await collect(await openedArchive.stream(1)), data)
    expectSameBytes(await openedArchive.read(1, 7, 17), data.subarray(7, 17))
  })

  it('does not serve a GZIP of several parts: the browser decodes one part', async () => {
    const two = Buffer.concat([
      gzipSync(Buffer.from('part one')),
      gzipSync(Buffer.from('part two')),
    ])
    const { archive } = await opened(two, 'parts.gz')
    const listing = archive.listing()
    // The entry is listed, marked as damaged, and cannot be opened: the
    // part that was read is not the file.
    expect(listing.truncated).toBe('damaged')
    expect(listing.entries).toEqual([
      { path: 'parts', type: 'file', size: 8, issue: 'damaged' },
    ])
    expect(listing.extraction.available).toBe(false)
    await expect(archive.stream(0)).rejects.toThrow(/damaged/)
  })

  it('keeps the limits it states', () => {
    expect(CLIENT_ARCHIVE_LIMITS.centralDirectoryBytes).toBe(16 * 1024 ** 2)
    expect(CLIENT_ARCHIVE_LIMITS.discardBytes).toBe(256 * 1024 ** 2)
  })
})

describe('archives the browser writes', () => {
  const entries = [
    input('photos/harbor.png', randomBytes(200_000)),
    input('notes-ünï.txt', 'text with repeats '.repeat(4000)),
    input('empty.bin', new Uint8Array(0)),
    input(`${'long-name-'.repeat(15)}.txt`, 'a long name'),
  ]

  async function contentOf(entry: ArchiveInput) {
    return collect((await entry.open()) as AsyncIterable<Uint8Array>)
  }

  it('writes a ZIP that the server reader accepts, entry by entry', async () => {
    const zip = await collect(zipBytes(entries))
    const directory = await mkdtemp(join(tmpdir(), 'flare-zip-'))
    try {
      const path = join(directory, 'made.zip')
      await writeFile(path, zip)
      // The strict reader checks every size and CRC-32.
      const manifest = await readArchive(path, 'made.zip')
      expect(manifest.entries.map((entry) => entry.path)).toEqual(
        entries.map((entry) => entry.name.normalize('NFKC'))
      )
      expect(manifest.entries.map((entry) => entry.size)).toEqual(
        entries.map((entry) => entry.size)
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    // And the browser reader reads it back.
    const { archive } = await opened(zip, 'made.zip')
    for (const [position, entry] of entries.entries())
      expectSameBytes(
        await collect(await archive.stream(position)),
        await contentOf(entry)
      )
    // Text is deflated: the archive is smaller than its content.
    expect(zip.length).toBeLessThan(260_000)
  })

  it('writes a TAR.GZ that the server reader accepts', async () => {
    const archive = await collect(tarGzBytes(entries))
    const directory = await mkdtemp(join(tmpdir(), 'flare-tar-'))
    try {
      const path = join(directory, 'made.tar.gz')
      await writeFile(path, archive)
      const manifest = await readArchive(path, 'made.tar.gz')
      expect(manifest.entries.map((entry) => entry.path)).toEqual(
        entries.map((entry) => entry.name.normalize('NFKC'))
      )
      expect(manifest.totalBytes).toBe(
        entries.reduce((sum, entry) => sum + entry.size!, 0)
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    const plain = gunzipSync(archive)
    expect(plain.length % 512).toBe(0)
    expect(plain.subarray(-1024).every((byte) => byte === 0)).toBe(true)
  })

  it('refuses a TAR entry that does not have the size it declared', async () => {
    const liar: ArchiveInput = {
      name: 'liar.bin',
      size: 10,
      async *open() {
        yield new Uint8Array(11)
      },
    }
    await expect(collect(tarBytes([liar]))).rejects.toThrow(/size it declared/)
  })

  it('leaves a failed entry out of a ZIP when the caller says to go on', async () => {
    const broken: ArchiveInput = {
      name: 'broken.bin',
      size: 100_000,
      async *open() {
        yield new Uint8Array(50_000)
        throw new Error('tag mismatch')
      },
    }
    const skipped: string[] = []
    const zip = await collect(
      zipBytes([entries[0], broken, entries[1]], {
        onFailure: (failed) => {
          skipped.push(failed.name)
          return true
        },
      })
    )
    expect(skipped).toEqual(['broken.bin'])
    const { archive } = await opened(zip, 'partial.zip')
    expect(archive.listing().entries.map((entry) => entry.path)).toEqual([
      entries[0].name,
      entries[1].name,
    ])
    expectSameBytes(
      await collect(await archive.stream(1)),
      await contentOf(entries[1])
    )
    // Without the callback the archive fails as a whole.
    await expect(collect(zipBytes([broken]))).rejects.toThrow('tag mismatch')
  })

  it('uses the 64-bit form for an entry without a known size', async () => {
    const unknown: ArchiveInput = {
      name: 'stream.bin',
      async *open() {
        yield randomBytes(70_000)
      },
    }
    const zip = await collect(zipBytes([unknown], { compress: false }))
    const { archive } = await opened(zip, 'stream.zip')
    expect(archive.listing().entries[0].size).toBe(70_000)
    expect((await collect(await archive.stream(0))).length).toBe(70_000)
  })
})

describe('creating an archive from files', () => {
  it('names members as the server does', () => {
    expect(
      memberNames([
        'report.pdf',
        'Report.pdf',
        'dir/sub/report.pdf',
        '..',
        'a:b.txt',
        'con\u0007trol.txt',
        '',
      ])
    ).toEqual([
      'report.pdf',
      'Report (2).pdf',
      'report (3).pdf',
      'file',
      'a-b.txt',
      'control.txt',
      'file (2)',
    ])
  })

  it('builds a ZIP from encrypted and plain sources and uploads it encrypted', async () => {
    const secret = randomBytes(180_000)
    const plain = Buffer.from('a plain source file\n'.repeat(100))
    const stored = await encrypted(secret)
    const server = fakeServer({ [URL]: stored })
    const fetch: JobEnvironment['fetch'] = (url, init) =>
      url === '/api/files/alexm/plain.txt'
        ? Promise.resolve(new Response(plain))
        : server.fetch(url, init)
    let uploaded: (EncryptedStreamSource & { all: Uint8Array }) | null = null
    const result = await createEncryptedArchive(
      [
        {
          encrypted: true,
          url: URL,
          fileKey,
          header,
          storedLength: stored.length,
          name: 'secret.bin',
          type: 'application/octet-stream',
        },
        {
          encrypted: false,
          url: '/api/files/alexm/plain.txt',
          name: 'plain.txt',
          size: plain.length,
        },
      ],
      { name: 'Archive.zip', format: 'zip' },
      { folderId: null, profileId: null, visibility: 'PRIVATE' },
      {
        fetch,
        accountPublicKey: new Uint8Array(32),
        signal: new AbortController().signal,
        async upload(source) {
          uploaded = {
            ...source,
            all: await collect(source.bytes as AsyncIterable<Uint8Array>),
          }
          return {
            id: 'new-file',
            url: 'https://flare.example/alexm/e_NEW#key',
            name: source.name,
            size: 1,
            type: source.type,
            records: {
              header: 'h',
              sealedMetadata: 's',
              accountStanza: 'a',
              stanzaAccountPublicKey: 'p',
            },
          }
        },
      }
    )
    expect(result).toMatchObject({
      id: 'new-file',
      urlPath: '/alexm/e_NEW',
      name: 'Archive.zip',
    })
    expect(uploaded!.name).toBe('Archive.zip')
    expect(uploaded!.type).toBe('application/zip')
    // The size is not known before the archive is written.
    expect(uploaded!.size).toBeUndefined()
    expect(result.totalBytes).toBe(uploaded!.all.length)
    const { archive } = await opened(uploaded!.all, 'Archive.zip')
    expect(archive.listing().entries.map((entry) => entry.path)).toEqual([
      'secret.bin',
      'plain.txt',
    ])
    expectSameBytes(await collect(await archive.stream(0)), secret)
    expectSameBytes(await collect(await archive.stream(1)), plain)
  })

  it('refuses a source over 256 MiB and a selection over 512 MiB before it reads them', async () => {
    const environment: JobEnvironment = {
      fetch: async () => {
        throw new Error('Nothing may be fetched')
      },
      upload: async () => {
        throw new Error('Nothing may be uploaded')
      },
      accountPublicKey: new Uint8Array(32),
      signal: new AbortController().signal,
    }
    const plain = (name: string, size: number) =>
      ({ encrypted: false, url: `/api/files/a/${name}`, name, size }) as const
    await expect(
      createEncryptedArchive(
        [plain('huge.bin', 257 * 1024 ** 2)],
        { name: 'a.zip', format: 'zip' },
        {},
        environment
      )
    ).rejects.toThrow(/256 MiB/)
    await expect(
      createEncryptedArchive(
        [1, 2, 3].map((index) => plain(`part-${index}.bin`, 200 * 1024 ** 2)),
        { name: 'a.zip', format: 'zip' },
        {},
        environment
      )
    ).rejects.toThrow(/512 MiB/)
    await expect(
      createEncryptedArchive(
        [],
        { name: 'a.zip', format: 'zip' },
        {},
        environment
      )
    ).rejects.toThrow(/Select between/)
  })
})

describe('names and types of extracted files', () => {
  it('keeps the path of an entry in its name', () => {
    expect(extractedName('a.txt')).toBe('a.txt')
    expect(extractedName('photos/2026/harbor.png')).toBe(
      'photos - 2026 - harbor.png'
    )
    expect(extractedName('x'.repeat(400)).length).toBe(255)
  })

  it('claims a type from the extension, and the generic type otherwise', () => {
    expect(typeOfName('a.PNG')).toBe('image/png')
    expect(typeOfName('page.html')).toBe('text/html')
    expect(typeOfName('unknown.xyz')).toBe('application/octet-stream')
    expect(typeOfName('noextension')).toBe('application/octet-stream')
  })
})
