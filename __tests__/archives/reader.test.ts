import archiver from 'archiver'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'
import * as tar from 'tar-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ArchiveIndex,
  assessExtraction,
  normalizeBrowsePath,
} from '@/lib/archives/archive-index'
import { archiveEntry, archiveListing } from '@/lib/archives/browse'
import { openByteSource } from '@/lib/archives/byte-source'
import { openEntryRange } from '@/lib/archives/entry-reader'
import {
  IDLE_ENTRY_STREAM_MS,
  entryResponse,
  parseByteRange,
} from '@/lib/archives/entry-response'
import {
  GzipSeekIndex,
  gzipDiscard,
  inflateIndexed,
  openGzipRange,
} from '@/lib/archives/gzip-reader'
import {
  ARCHIVE_INDEX_CONCURRENCY,
  ARCHIVE_INDEX_FAILURE_MS,
  ARCHIVE_INDEX_JOBS_PER_REQUESTER,
  buildArchiveIndex,
  clearArchiveIndexCache,
  getArchiveIndex,
} from '@/lib/archives/index-cache'
import {
  ARCHIVE_BROWSE_LIMITS,
  type ArchiveFormat,
} from '@/lib/archives/shared'
import {
  ARCHIVE_IDLE_MS,
  SLICE_PROGRESS,
  concatStreams,
  readUpTo,
} from '@/lib/archives/stream-slice'
import { createArchiveUnlock, verifyArchiveUnlock } from '@/lib/archives/unlock'
import type { StorageProvider } from '@/lib/storage'

/** Object storage double: ranged streams only, counting each request. */
function remoteStorage(bytes: Buffer, stats = { requests: 0, bytes: 0 }) {
  return {
    kind: 's3',
    target: { provider: 's3' },
    async getFileSize() {
      return bytes.length
    },
    async getFileStream(
      _path: string,
      range?: { start?: number; end?: number }
    ) {
      stats.requests++
      const start = range?.start ?? 0
      const end = range?.end === undefined ? bytes.length : range.end + 1
      stats.bytes += end - start
      const slice = bytes.subarray(start, end)
      const chunks = []
      for (let offset = 0; offset < slice.length; offset += 16384)
        chunks.push(slice.subarray(offset, offset + 16384))
      return Readable.from(chunks)
    },
  } as unknown as StorageProvider
}

/** Local storage double with positional reads. */
function localStorage(bytes: Buffer) {
  return {
    ...remoteStorage(bytes),
    kind: 'local',
    async openRandomAccess() {
      return {
        size: bytes.length,
        async read(position: number, length: number) {
          return Buffer.from(bytes.subarray(position, position + length))
        },
        async close() {},
      }
    },
  } as unknown as StorageProvider
}

async function indexOf(
  bytes: Buffer,
  format: ArchiveFormat,
  name = `fixture.${format}`,
  storage = remoteStorage(bytes)
) {
  const source = await openByteSource(storage, 'fixture')
  const index = new ArchiveIndex(format, source.size)
  await buildArchiveIndex(source, index, name, new AbortController().signal)
  index.complete = true
  return { index, source }
}

async function read(
  bytes: Buffer,
  format: ArchiveFormat,
  path: string,
  start?: number,
  end?: number,
  name?: string
) {
  const { index, source } = await indexOf(bytes, format, name)
  const entry = index.find(path)
  if (!entry) throw new Error(`missing ${path}`)
  const chunks: Buffer[] = []
  for await (const chunk of await openEntryRange(
    source,
    index,
    entry,
    start ?? 0,
    end ?? entry.size
  ))
    chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function zipBytes(
  files: { name: string; data?: Buffer | string; store?: boolean }[],
  options: archiver.ArchiverOptions = {}
) {
  const archive = archiver('zip', options)
  const chunks: Buffer[] = []
  const collecting = (async () => {
    for await (const chunk of archive) chunks.push(Buffer.from(chunk))
  })()
  for (const file of files)
    if (file.name.endsWith('/'))
      archive.append('', { name: file.name, type: 'directory' } as never)
    else
      archive.append(file.data ?? '', {
        name: file.name,
        store: file.store,
      })
  await archive.finalize()
  await collecting
  return Buffer.concat(chunks)
}

/** Hand-written ZIP for flags and names that real writers refuse to produce. */
function rawZip(
  items: {
    name: Buffer
    data: Buffer
    flags?: number
    method?: number
    mode?: number
    crc?: number
  }[]
) {
  const contents: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const stored = item.method === 8 ? deflateRawSync(item.data) : item.data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(item.flags ?? 0, 6)
    local.writeUInt16LE(item.method ?? 0, 8)
    local.writeUInt32LE(item.crc ?? crc32(item.data), 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(item.data.length, 22)
    local.writeUInt16LE(item.name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    local.copy(central, 6, 4, 28)
    central.writeUInt32LE(((item.mode ?? 0o100644) * 65536) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    contents.push(local, item.name, stored)
    directory.push(central, item.name)
    offset += 30 + item.name.length + stored.length
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

async function tarBytes(
  entries: {
    name: string
    type?: tar.Header['type']
    data?: Buffer | string
    linkname?: string
  }[]
) {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  const consuming = (async () => {
    for await (const chunk of pack)
      chunks.push(Buffer.from(chunk as Uint8Array))
  })()
  for (const entry of entries)
    pack.entry(
      {
        name: entry.name,
        type: entry.type ?? 'file',
        linkname: entry.linkname,
      },
      entry.data ?? ''
    )
  pack.finalize()
  await consuming
  return Buffer.concat(chunks)
}

/** One ustar header block, for header sequences tar writers won't produce. */
function tarHeader(name: string, typeflag: string, size: number) {
  const block = Buffer.alloc(512)
  block.write(name, 0)
  block.write('0000644\0', 100)
  block.write(size.toString(8).padStart(11, '0') + '\0', 124)
  block.write('00000000000\0', 136)
  block.write(typeflag, 156)
  block.write('ustar\u000000', 257, 'latin1')
  block.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return block
}

function paxBlock(records: Record<string, string>, typeflag = 'x') {
  let data = ''
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`
    let length = body.length + 1
    while (`${length}${body}`.length !== length) length++
    data += `${length}${body}`
  }
  const bytes = Buffer.from(data)
  return Buffer.concat([
    tarHeader('PaxHeader', typeflag, bytes.length),
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ])
}

/** Member names as the extractor's TAR parser reads them. */
async function tarStreamNames(bytes: Buffer) {
  const extract = tar.extract()
  const names: string[] = []
  const reading = (async () => {
    for await (const entry of extract) {
      names.push(entry.header.name)
      entry.resume()
    }
  })()
  extract.end(bytes)
  await reading
  return names
}

/** Text that compresses well plus incompressible blocks, like real archives. */
function mixedData(size: number) {
  const parts: Buffer[] = []
  let total = 0
  for (let index = 0; total < size; index++) {
    const part =
      index % 3 === 2
        ? randomBytes(48 * 1024)
        : Buffer.from(`line ${index} `.repeat(4096))
    parts.push(part)
    total += part.length
  }
  return Buffer.concat(parts).subarray(0, size)
}

/** Chunks delivered through promises only, never giving timers a turn. */
async function* withoutTurns(bytes: Buffer, size = 64 * 1024) {
  for (let offset = 0; offset < bytes.length; offset += size)
    yield bytes.subarray(offset, offset + size)
}

/** Where member `index` of concatenated buffers starts. */
function offsetOf(parts: Buffer[], index: number) {
  return parts.slice(0, index).reduce((total, part) => total + part.length, 0)
}

/** Run with a smaller decoded-byte discard limit. */
async function withDiscardLimit<T>(bytes: number, run: () => Promise<T>) {
  const limits = ARCHIVE_BROWSE_LIMITS as { discardBytes: number }
  const original = limits.discardBytes
  limits.discardBytes = bytes
  try {
    return await run()
  } finally {
    limits.discardBytes = original
  }
}

afterEach(() => clearArchiveIndexCache())

describe('ZIP index', () => {
  it('lists from the central directory and reads only the requested entry', async () => {
    const big = mixedData(3 * 1024 * 1024)
    const bytes = await zipBytes([
      { name: 'docs/readme.md', data: '# Hello\n' },
      { name: 'docs/' },
      { name: 'media/big.bin', data: big },
      { name: 'media/stored.bin', data: big.subarray(0, 300_000), store: true },
    ])
    const stats = { requests: 0, bytes: 0 }
    const { index } = await indexOf(
      bytes,
      'zip',
      'fixture.zip',
      remoteStorage(bytes, stats)
    )
    expect(index.entries.map((entry) => [entry.path, entry.type])).toEqual([
      ['docs/readme.md', 'file'],
      ['docs', 'directory'],
      ['media/big.bin', 'file'],
      ['media/stored.bin', 'file'],
    ])
    expect(index.fileCount).toBe(3)
    expect(index.totalBytes).toBe(8 + big.length + 300_000)
    // Listing touched the tail and directory, not the multi-megabyte data.
    expect(stats.bytes).toBeLessThan(600 * 1024)
    expect((await read(bytes, 'zip', 'docs/readme.md')).toString()).toBe(
      '# Hello\n'
    )
    expect((await read(bytes, 'zip', 'media/big.bin')).equals(big)).toBe(true)
    expect(
      (await read(bytes, 'zip', 'media/big.bin', 1_000_000, 1_000_100)).equals(
        big.subarray(1_000_000, 1_000_100)
      )
    ).toBe(true)
    expect(
      (await read(bytes, 'zip', 'media/stored.bin', 299_000)).equals(
        big.subarray(299_000, 300_000)
      )
    ).toBe(true)
  })

  it('reads ZIP64 archives and archives with prepended data', async () => {
    const data = randomBytes(200_000)
    const zip64 = await zipBytes([{ name: 'a/data.bin', data }], {
      forceZip64: true,
    } as archiver.ArchiverOptions)
    expect((await read(zip64, 'zip', 'a/data.bin')).equals(data)).toBe(true)
    const prefixed = Buffer.concat([randomBytes(4096), zip64])
    expect((await read(prefixed, 'zip', 'a/data.bin')).equals(data)).toBe(true)
    const plain = await zipBytes([{ name: 'x.txt', data: 'x' }])
    const stub = Buffer.concat([Buffer.alloc(1000, 0x4d), plain])
    expect((await read(stub, 'zip', 'x.txt')).toString()).toBe('x')
  })

  it('decodes UTF-8 without the flag, CP437, and the Unicode path field', async () => {
    const bytes = rawZip([
      { name: Buffer.from('café.txt'), data: Buffer.from('utf8') },
      { name: Buffer.from([0x82, 0x74, 0x65]), data: Buffer.from('cp437') },
      {
        name: Buffer.from('flagged-ü.txt'),
        data: Buffer.from('flag'),
        flags: 0x800,
      },
    ])
    const { index } = await indexOf(bytes, 'zip')
    expect(index.entries.map((entry) => entry.path)).toEqual([
      'café.txt',
      'éte',
      'flagged-ü.txt',
    ])
  })

  it('lists problem entries with a reason instead of rejecting the archive', async () => {
    const bytes = rawZip([
      { name: Buffer.from('ok.txt'), data: Buffer.from('ok') },
      { name: Buffer.from('secret.txt'), data: Buffer.from('x'), flags: 1 },
      { name: Buffer.from('bzip.txt'), data: Buffer.from('x'), method: 12 },
      {
        name: Buffer.from('link'),
        data: Buffer.from('ok.txt'),
        mode: 0o120777,
      },
      { name: Buffer.from('../escape.txt'), data: Buffer.from('x') },
      { name: Buffer.from('fifo'), data: Buffer.alloc(0), mode: 0o010644 },
    ])
    const { index } = await indexOf(bytes, 'zip')
    expect(
      index.entries.map((entry) => [entry.path, entry.issue ?? null])
    ).toEqual([
      ['ok.txt', null],
      ['secret.txt', 'encrypted'],
      ['bzip.txt', 'compression'],
      ['link', 'link'],
      ['../escape.txt', 'unsafe-path'],
      ['fifo', 'special'],
    ])
    expect(index.listing().extraction).toEqual({
      available: false,
      reason: expect.stringContaining('encrypted'),
    })
    expect((await read(bytes, 'zip', 'ok.txt')).toString()).toBe('ok')
  })

  it('reports a damaged member when its contents are read, not when listing', async () => {
    const bytes = rawZip([
      { name: Buffer.from('good.txt'), data: Buffer.from('good'), method: 8 },
      {
        name: Buffer.from('bad.txt'),
        data: Buffer.from('bad data'),
        method: 8,
        crc: 1234,
      },
    ])
    const { index } = await indexOf(bytes, 'zip')
    expect(index.entries).toHaveLength(2)
    await expect(read(bytes, 'zip', 'bad.txt')).rejects.toThrow(/integrity/)
    // A partial range cannot be checksummed and is served as stored.
    expect((await read(bytes, 'zip', 'bad.txt', 0, 3)).toString()).toBe('bad')
    expect((await read(bytes, 'zip', 'good.txt')).toString()).toBe('good')
  })

  it('rejects files that are not ZIP archives with a clear message', async () => {
    await expect(
      indexOf(Buffer.from('not a zip at all, just text'), 'zip')
    ).rejects.toThrow(/couldn’t find this ZIP archive’s file list/)
  })

  it('stops at the browse entry limit and says so', async () => {
    const names = Array.from({ length: 30 }, (_, index) => ({
      name: Buffer.from(`f${index}.txt`),
      data: Buffer.from('x'),
    }))
    const source = await openByteSource(remoteStorage(rawZip(names)), 'f')
    const index = new ArchiveIndex('zip', source.size)
    const { indexZip } = await import('@/lib/archives/zip-reader')
    await indexZip(source, index, { entries: 10, directoryBytes: 1 << 20 })
    expect(index.entries).toHaveLength(10)
    expect(index.truncated).toBe('entries')
    expect(index.entryCount).toBe(30)
  })
})

describe('TAR index', () => {
  it('hops over member data and reads byte ranges directly', async () => {
    const big = randomBytes(2 * 1024 * 1024)
    const longName = `deep/${'nested-folder/'.repeat(12)}file.txt`
    const bytes = await tarBytes([
      { name: 'dir', type: 'directory' },
      { name: 'dir/big.bin', data: big },
      { name: longName, data: 'long' },
      { name: 'link', type: 'symlink', linkname: 'dir/big.bin' },
      { name: 'small.txt', data: 'small' },
    ])
    const stats = { requests: 0, bytes: 0 }
    const { index } = await indexOf(
      bytes,
      'tar',
      'fixture.tar',
      remoteStorage(bytes, stats)
    )
    expect(
      index.entries.map((entry) => [entry.path, entry.issue ?? entry.type])
    ).toEqual([
      ['dir', 'directory'],
      ['dir/big.bin', 'file'],
      [longName, 'file'],
      ['link', 'link'],
      ['small.txt', 'file'],
    ])
    expect(index.truncated).toBeNull()
    expect(stats.bytes).toBeLessThan(big.length)
    expect(
      (await read(bytes, 'tar', 'dir/big.bin', 5, 15)).equals(
        big.subarray(5, 15)
      )
    ).toBe(true)
    expect((await read(bytes, 'tar', longName)).toString()).toBe('long')
    expect(
      (await indexOf(bytes, 'tar', 'fixture.tar', localStorage(bytes))).index
        .entries
    ).toHaveLength(5)
  })

  it('stops a listing at its memory budget instead of growing without bound', async () => {
    const longName = (index: number) =>
      `${'nested/'.repeat(40)}file-${index}.txt`
    const tarball = await tarBytes(
      Array.from({ length: 60 }, (_, index) => ({
        name: longName(index),
        data: 'x',
      }))
    )
    const source = await openByteSource(remoteStorage(tarball), 't')
    const index = new ArchiveIndex('tar', source.size, 16 * 1024)
    await buildArchiveIndex(
      source,
      index,
      'deep.tar',
      new AbortController().signal
    )
    expect(index.truncated).toBe('size')
    expect(index.entries.length).toBeGreaterThan(0)
    expect(index.entries.length).toBeLessThan(60)
    expect(index.memoryBytes).toBeLessThanOrEqual(16 * 1024)

    const zip = rawZip(
      Array.from({ length: 60 }, (_, index) => ({
        name: Buffer.from(longName(index)),
        data: Buffer.from('x'),
      }))
    )
    const zipSource = await openByteSource(remoteStorage(zip), 'z')
    const zipIndex = new ArchiveIndex('zip', zipSource.size, 16 * 1024)
    await buildArchiveIndex(
      zipSource,
      zipIndex,
      'deep.zip',
      new AbortController().signal
    )
    expect(zipIndex.truncated).toBe('size')
    expect(zipIndex.memoryBytes).toBeLessThanOrEqual(16 * 1024)
    expect(zipIndex.listing().extraction.available).toBe(false)
  })

  it('lets timers run while it parses a large central directory', async () => {
    const bytes = rawZip(
      Array.from({ length: 10_000 }, (_, index) => ({
        name: Buffer.from(`file-${index}.txt`),
        data: Buffer.alloc(0),
      }))
    )
    const source = await openByteSource(localStorage(bytes), 'zip')
    const index = new ArchiveIndex('zip', source.size)
    let firedAt: number | null = null
    const timer = setTimeout(() => (firedAt = index.entries.length), 0)
    await buildArchiveIndex(
      source,
      index,
      'many.zip',
      new AbortController().signal
    )
    clearTimeout(timer)
    expect(index.entries).toHaveLength(10_000)
    expect(firedAt).not.toBeNull()
    expect(firedAt!).toBeLessThan(10_000)
  })

  it('lets each PAX header replace the previous one, as the extractor does', async () => {
    const bytes = Buffer.concat([
      paxBlock({ path: 'renamed-by-first-header.txt' }),
      ...Array.from({ length: 200 }, (_, index) =>
        paxBlock({ comment: 'x'.repeat(2000), [`key${index}`]: 'value' })
      ),
      tarHeader('real.txt', '0', 4),
      Buffer.from('real'),
      Buffer.alloc(508),
      Buffer.alloc(1024),
    ])
    const { index } = await indexOf(bytes, 'tar')
    expect(index.entries.map((entry) => entry.path)).toEqual(['real.txt'])
    expect((await read(bytes, 'tar', 'real.txt')).toString()).toBe('real')
  })

  it('parses hostile PAX length fields in linear time', async () => {
    // A record without "=" ends parsing, as in tar-stream, instead of
    // advancing one byte at a time through a long zero-padded length.
    const records = Buffer.from(`${'0'.repeat(600_000)}1 path=never.txt\n`)
    const bytes = Buffer.concat([
      tarHeader('PaxHeader', 'x', records.length),
      records,
      Buffer.alloc((512 - (records.length % 512)) % 512),
      tarHeader('real.txt', '0', 4),
      Buffer.from('real'),
      Buffer.alloc(508),
      Buffer.alloc(1024),
    ])
    const started = performance.now()
    const { index } = await indexOf(bytes, 'tar')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(index.entries.map((entry) => entry.path)).toEqual(['real.txt'])
    expect(await tarStreamNames(bytes)).toEqual(['real.txt'])
  })

  it('applies global and empty PAX values the way the extractor does', async () => {
    const bytes = Buffer.concat([
      paxBlock({ path: 'from-global.txt', comment: 'abc123' }, 'g'),
      paxBlock({ comment: 'own extended header' }),
      tarHeader('header-name.txt', '0', 0),
      tarHeader('no-extended-header.txt', '0', 0),
      paxBlock({ path: '' }),
      tarHeader('empty-pax-path.txt', '0', 0),
      Buffer.alloc(1024),
    ])
    const names = await tarStreamNames(bytes)
    expect(names).toEqual([
      'from-global.txt',
      'no-extended-header.txt',
      'empty-pax-path.txt',
    ])
    const { index } = await indexOf(bytes, 'tar')
    expect(index.entries.map((entry) => entry.path)).toEqual(names)
  })

  it('keeps the readable entries of a truncated TAR and flags the cut', async () => {
    const bytes = await tarBytes([
      { name: 'one.txt', data: 'one' },
      { name: 'two.bin', data: randomBytes(4000) },
    ])
    // The second header is complete but its data is cut short.
    const { index } = await indexOf(bytes.subarray(0, 2000), 'tar')
    expect(index.entries.map((entry) => entry.path)).toEqual([
      'one.txt',
      'two.bin',
    ])
    expect(index.find('two.bin')?.issue).toBe('damaged')
    expect(index.truncated).toBe('damaged')
    await expect(indexOf(Buffer.alloc(1024, 7), 'tar')).rejects.toThrow(
      /isn’t a readable TAR/
    )
  })
})

describe('TAR.GZ and GZIP seeking', () => {
  it('records byte-aligned checkpoints that resume native inflation exactly', async () => {
    const data = mixedData(6 * 1024 * 1024)
    const compressed = gzipSync(data)
    const seek = new GzipSeekIndex(256 * 1024)
    let output = 0
    for await (const chunk of inflateIndexed(
      Readable.from([compressed]),
      seek,
      { consumed() {}, tick() {} }
    ))
      output += chunk.length
    expect(output).toBe(data.length)
    expect(seek.checkpoints.length).toBeGreaterThan(5)
    const source = await openByteSource(remoteStorage(compressed), 'gz')
    for (const start of [0, 777_777, 2_500_001, 4_000_000, data.length - 10]) {
      const chunks: Buffer[] = []
      for await (const chunk of await openGzipRange(
        source,
        seek,
        start,
        Math.min(data.length, start + 50_000)
      ))
        chunks.push(chunk as Buffer)
      expect(
        Buffer.concat(chunks).equals(data.subarray(start, start + 50_000))
      ).toBe(true)
    }
  })

  it('indexes a TAR.GZ once and serves late entries from a checkpoint', async () => {
    const late = mixedData(512 * 1024)
    const tarball = await tarBytes([
      { name: 'filler.bin', data: mixedData(20 * 1024 * 1024) },
      { name: 'late/notes.txt', data: late },
    ])
    const compressed = gzipSync(tarball)
    const stats = { requests: 0, bytes: 0 }
    const { index, source } = await indexOf(
      compressed,
      'tar.gz',
      'fixture.tar.gz',
      remoteStorage(compressed, stats)
    )
    expect(index.entries.map((entry) => entry.path)).toEqual([
      'filler.bin',
      'late/notes.txt',
    ])
    expect(index.gzip?.checkpoints.length).toBeGreaterThan(1)
    const before = stats.bytes
    const entry = index.find('late/notes.txt')!
    const chunks: Buffer[] = []
    for await (const chunk of await openEntryRange(
      source,
      index,
      entry,
      100,
      200
    ))
      chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).equals(late.subarray(100, 200))).toBe(true)
    // The read resumed near the entry instead of decompressing from byte 0.
    expect(stats.bytes - before).toBeLessThan(compressed.length)
  })

  it('reads concatenated members in order and ignores trailing padding', async () => {
    const first = Buffer.from('first member\n'.repeat(1000))
    const second = Buffer.from('second member\n'.repeat(1000))
    const bytes = Buffer.concat([
      gzipSync(first),
      gzipSync(second),
      Buffer.alloc(512),
    ])
    const { index } = await indexOf(bytes, 'gzip', 'notes.log.gz')
    expect(index.entries).toEqual([
      expect.objectContaining({ path: 'notes.log', size: 27000 }),
    ])
    expect(index.gzip?.firstMemberOutput).toBe(first.length)
    expect(
      (
        await read(bytes, 'gzip', 'notes.log', 12990, 13020, 'notes.log.gz')
      ).toString()
    ).toBe(Buffer.concat([first, second]).subarray(12990, 13020).toString())
  })

  it('refuses to serve a GZIP file cut short by the listing budget', async () => {
    const compressed = gzipSync(mixedData(1024 * 1024))
    const source = await openByteSource(remoteStorage(compressed), 'gz')
    const index = new ArchiveIndex('gzip', source.size)
    await buildArchiveIndex(
      source,
      index,
      'big.log.gz',
      new AbortController().signal,
      { bytes: 64 * 1024 }
    )
    expect(index.truncated).toBe('size')
    expect(index.entries).toEqual([
      expect.objectContaining({ path: 'big.log', issue: 'incomplete' }),
    ])
    await expect(
      entryResponse({
        source,
        index,
        entry: index.entries[0],
        range: null,
        inline: false,
        release: () => {},
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ status: 415 })
  })

  it('resumes later gzip members from their own start', async () => {
    const tarball = await tarBytes(
      Array.from({ length: 12 }, (_, index) => ({
        name: `part${index}.bin`,
        data: mixedData(1024 * 1024),
      }))
    )
    // Like bgzip: many independent members, each with its own header.
    const members: Buffer[] = []
    for (let offset = 0; offset < tarball.length; offset += 512 * 1024)
      members.push(gzipSync(tarball.subarray(offset, offset + 512 * 1024)))
    const compressed = Buffer.concat(members)
    const storage = remoteStorage(compressed)
    const starts: number[] = []
    const open = storage.getFileStream.bind(storage)
    storage.getFileStream = async (...args: Parameters<typeof open>) => {
      starts.push(args[1]?.start ?? 0)
      return open(...args)
    }
    const { index, source } = await indexOf(
      compressed,
      'tar.gz',
      'parts.tar.gz',
      storage
    )
    expect(index.gzip?.checkpoints.some((point) => point.member)).toBe(true)
    const entry = index.find('part11.bin')!
    const chunks: Buffer[] = []
    for await (const chunk of await openEntryRange(
      source,
      index,
      entry,
      0,
      entry.size
    ))
      chunks.push(chunk as Buffer)
    expect(
      Buffer.concat(chunks).equals(
        tarball.subarray(entry.offset, entry.offset + entry.size)
      )
    ).toBe(true)
    // Gunzip started at a later member header rather than at byte 0.
    expect(starts.at(-1)).toBeGreaterThan(0)
    expect(members.some((_, i) => starts.at(-1) === offsetOf(members, i))).toBe(
      true
    )
  })

  it('refuses files too deep to reach and ignores deep byte ranges', async () => {
    const first = mixedData(3 * 1024 * 1024)
    const tarball = await tarBytes([
      { name: 'first.bin', data: first },
      { name: 'spanning.bin', data: mixedData(2 * 1024 * 1024) },
      { name: 'after.txt', data: 'after' },
    ])
    const spanning = (await indexOf(tarball, 'tar')).index.find('spanning.bin')!
    // The first member is shorter than the 8 MiB checkpoint spacing, so the
    // only point before spanning.bin is the start of the file.
    const split = spanning.offset + 1024 * 1024
    const compressed = Buffer.concat([
      gzipSync(tarball.subarray(0, split)),
      gzipSync(tarball.subarray(split)),
    ])
    const { index, source } = await indexOf(compressed, 'tar.gz')
    const respond = (path: string, range: string | null) =>
      entryResponse({
        source,
        index,
        entry: index.find(path)!,
        range,
        inline: false,
        release: () => {},
        signal: new AbortController().signal,
      })
    await withDiscardLimit(1024 * 1024, async () => {
      await expect(respond('spanning.bin', null)).rejects.toMatchObject({
        status: 413,
        message: expect.stringContaining('Download the whole archive'),
      })
      const near = await respond('first.bin', 'bytes=0-9')
      expect(near.status).toBe(206)
      expect(Buffer.from(await near.arrayBuffer())).toEqual(
        first.subarray(0, 10)
      )
      const deep = await respond('first.bin', 'bytes=2097152-2097161')
      expect(deep.status).toBe(200)
      expect(deep.headers.get('content-range')).toBeNull()
      expect(deep.headers.get('content-length')).toBe(String(first.length))
      expect(Buffer.from(await deep.arrayBuffer()).equals(first)).toBe(true)
    })
    // Within the default limit, the entry is read across the member boundary.
    const whole = await respond('spanning.bin', null)
    expect(whole.status).toBe(200)
    expect(
      Buffer.from(await whole.arrayBuffer()).equals(
        tarball.subarray(spanning.offset, spanning.offset + spanning.size)
      )
    ).toBe(true)
  })

  it('keeps the second member start even right after a block checkpoint', async () => {
    const small = 'This file starts in the second gzip member.'
    const tarball = await tarBytes([
      { name: 'big.bin', data: mixedData(9 * 1024 * 1024) },
      { name: 'small.txt', data: small },
    ])
    // Split just before small.txt's header, about 1 MiB after the block
    // checkpoint near 8 MiB: too close for the checkpoint spacing.
    const split =
      (await indexOf(tarball, 'tar')).index.find('small.txt')!.offset - 512
    const compressed = Buffer.concat([
      gzipSync(tarball.subarray(0, split)),
      gzipSync(tarball.subarray(split)),
    ])
    const { index, source } = await indexOf(compressed, 'tar.gz')
    expect(index.gzip!.checkpoints.some((point) => point.member)).toBe(false)
    expect(index.gzip!.secondMember).toMatchObject({ output: split })
    const respond = (range: string | null) =>
      entryResponse({
        source,
        index,
        entry: index.find('small.txt')!,
        range,
        inline: false,
        release: () => {},
        signal: new AbortController().signal,
      })
    await withDiscardLimit(1024 * 1024, async () => {
      const whole = await respond(null)
      expect(whole.status).toBe(200)
      expect(await whole.text()).toBe(small)
      const part = await respond('bytes=5-8')
      expect(part.status).toBe(206)
      expect(await part.text()).toBe(small.slice(5, 9))
    })
  })

  it('reads a range across the first member boundary from a nearby block point', async () => {
    const first = mixedData(3 * 1024 * 1024)
    const second = mixedData(1024 * 1024)
    const firstMember = gzipSync(first)
    const compressed = Buffer.concat([firstMember, gzipSync(second)])
    const seek = new GzipSeekIndex(256 * 1024)
    for await (const _chunk of inflateIndexed(
      Readable.from([compressed]),
      seek,
      { consumed() {}, tick() {} }
    )) {
      // Index the whole stream.
    }
    expect(seek.secondMember).toMatchObject({
      input: firstMember.length,
      output: first.length,
    })
    const start = first.length - 1000
    const end = first.length + 5000
    expect(gzipDiscard(seek, start)).toBeLessThan(1024 * 1024)
    const storage = remoteStorage(compressed)
    const starts: number[] = []
    const open = storage.getFileStream.bind(storage)
    storage.getFileStream = async (...args: Parameters<typeof open>) => {
      starts.push(args[1]?.start ?? 0)
      return open(...args)
    }
    const source = await openByteSource(storage, 'gz')
    const chunks: Buffer[] = []
    for await (const chunk of await openGzipRange(source, seek, start, end))
      chunks.push(chunk as Buffer)
    expect(
      Buffer.concat(chunks).equals(
        Buffer.concat([first, second]).subarray(start, end)
      )
    ).toBe(true)
    // A block point inside the first member, then the second member's header.
    expect(starts).toEqual([seek.resumeFor(start)!.input, firstMember.length])
    expect(starts[0]).toBeGreaterThan(0)
  })

  it('ignores a deep byte range in a deflated ZIP entry', async () => {
    const data = mixedData(3 * 1024 * 1024)
    const { index, source } = await indexOf(
      rawZip([{ name: Buffer.from('big.bin'), data, method: 8 }]),
      'zip'
    )
    const respond = (range: string) =>
      entryResponse({
        source,
        index,
        entry: index.find('big.bin')!,
        range,
        inline: false,
        release: () => {},
        signal: new AbortController().signal,
      })
    await withDiscardLimit(1024 * 1024, async () => {
      const near = await respond('bytes=1000-1999')
      expect(near.status).toBe(206)
      expect(Buffer.from(await near.arrayBuffer())).toEqual(
        data.subarray(1000, 2000)
      )
      const deep = await respond('bytes=2097152-')
      expect(deep.status).toBe(200)
      expect(Buffer.from(await deep.arrayBuffer()).equals(data)).toBe(true)
    })
  })

  it('lets timers run while it decodes a large stream', async () => {
    const compressed = gzipSync(mixedData(8 * 1024 * 1024))
    let output = 0
    let firedAt: number | null = null
    const timer = setTimeout(() => (firedAt = output), 0)
    for await (const chunk of inflateIndexed(
      withoutTurns(compressed),
      new GzipSeekIndex(),
      { consumed() {}, tick() {} }
    ))
      output += chunk.length
    clearTimeout(timer)
    expect(firedAt).not.toBeNull()
    expect(firedAt!).toBeLessThan(output)
  })

  it('lists what it could read from a truncated TAR.GZ', async () => {
    const tarball = await tarBytes([
      { name: 'a.txt', data: 'a'.repeat(1000) },
      { name: 'b.bin', data: randomBytes(300_000) },
    ])
    const compressed = gzipSync(tarball)
    const { index } = await indexOf(
      compressed.subarray(0, compressed.length / 2),
      'tar.gz'
    )
    expect(index.entries[0].path).toBe('a.txt')
    expect(index.truncated).toBe('damaged')
  })
})

describe('browse helpers', () => {
  it('normalizes display paths and flags unsafe ones', () => {
    expect(normalizeBrowsePath('./a/b/')).toEqual({
      path: 'a/b',
      unsafe: false,
    })
    expect(normalizeBrowsePath('/etc/passwd')).toEqual({
      path: 'etc/passwd',
      unsafe: true,
    })
    expect(normalizeBrowsePath('a\\b').unsafe).toBe(true)
    expect(normalizeBrowsePath('a//b')).toEqual({ path: 'a/b', unsafe: true })
    expect(normalizeBrowsePath('C:/x').unsafe).toBe(true)
    expect(normalizeBrowsePath('a/../b').unsafe).toBe(true)
    // Disguising characters are visible but do not block a preview.
    expect(normalizeBrowsePath('bell\u0007')).toEqual({
      path: 'bell\uFFFD',
      unsafe: false,
    })
    expect(normalizeBrowsePath('invoice\u202Etxt.exe').path).toBe(
      'invoice\uFFFDtxt.exe'
    )
  })

  it('answers HEAD without opening the entry, and releases unread bodies', async () => {
    const big = randomBytes(2 * 1024 * 1024)
    const bytes = await tarBytes([{ name: 'big.bin', data: big }])
    const { index, source } = await indexOf(bytes, 'tar')
    const entry = index.find('big.bin')!
    const headRelease = vi.fn()
    const head = await entryResponse({
      source,
      index,
      entry,
      range: null,
      inline: false,
      head: true,
      release: headRelease,
      signal: new AbortController().signal,
    })
    expect(head.body).toBeNull()
    expect(head.headers.get('content-length')).toBe(String(big.length))
    expect(headRelease).toHaveBeenCalledOnce()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const release = vi.fn()
      const unread = await entryResponse({
        source: (await indexOf(bytes, 'tar')).source,
        index,
        entry,
        range: null,
        inline: false,
        release,
        signal: new AbortController().signal,
      })
      expect(unread.body).not.toBeNull()
      expect(release).not.toHaveBeenCalled()
      vi.advanceTimersByTime(IDLE_ENTRY_STREAM_MS + 1)
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    } finally {
      vi.useRealTimers()
    }
  })

  it('parses single byte ranges', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 10 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 100 })
    expect(parseByteRange('bytes=-5', 100)).toEqual({ start: 95, end: 100 })
    expect(parseByteRange('bytes=50-500', 100)).toEqual({ start: 50, end: 100 })
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(parseByteRange('bytes=9-1', 100)).toBeNull()
  })

  it('explains why extraction is unavailable before any request', async () => {
    const fine = await indexOf(
      await zipBytes([{ name: 'a.txt', data: 'a' }]),
      'zip'
    )
    expect(assessExtraction(fine.index)).toEqual({ available: true })
    const many = rawZip(
      Array.from({ length: 1001 }, (_, index) => ({
        name: Buffer.from(`f${index}`),
        data: Buffer.alloc(0),
      }))
    )
    expect(assessExtraction((await indexOf(many, 'zip')).index)).toEqual({
      available: false,
      reason: expect.stringContaining('more than 1,000 files and folders'),
    })
    const big = new ArchiveIndex('zip', 300 * 1024 ** 2)
    big.complete = true
    expect(assessExtraction(big)).toEqual({
      available: false,
      reason: expect.stringContaining('256 MB extraction limit'),
    })
  })

  it('signs unlock cookies to one file and its current password', () => {
    const cookie = createArchiveUnlock('file-1', 'hash-a', true, 1_000_000)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/api/files/file-1/archive/share')
    const value = cookie.split(';')[0].split('=').slice(1).join('=')
    expect(verifyArchiveUnlock(value, 'file-1', 'hash-a', 1_000_000)).toBe(true)
    expect(verifyArchiveUnlock(value, 'file-2', 'hash-a', 1_000_000)).toBe(
      false
    )
    expect(verifyArchiveUnlock(value, 'file-1', 'hash-b', 1_000_000)).toBe(
      false
    )
    expect(verifyArchiveUnlock(value, 'file-1', null, 1_000_000)).toBe(false)
    expect(
      verifyArchiveUnlock(value, 'file-1', 'hash-a', 1_000_000 + 3601 * 1000)
    ).toBe(false)
  })
})

describe('index cache', () => {
  it('shares one indexing job and reuses the finished index', async () => {
    const bytes = await zipBytes([{ name: 'a.txt', data: 'a' }])
    const stats = { requests: 0, bytes: 0 }
    const ref = {
      key: 'cache-test',
      storage: remoteStorage(bytes, stats),
      path: 'x',
      name: 'x.zip',
      format: 'zip' as const,
    }
    const signal = new AbortController().signal
    const [first, second] = await Promise.all([
      getArchiveIndex(ref, { signal, wait: 'complete', requester: 'test' }),
      getArchiveIndex(ref, { signal, wait: 'complete', requester: 'test' }),
    ])
    expect(first.index).toBe(second.index)
    const requests = stats.requests
    const third = await getArchiveIndex(ref, {
      signal,
      wait: 'complete',
      requester: 'test',
    })
    expect(third.cached).toBe(true)
    expect(stats.requests).toBe(requests)
  })

  it('reports progress for a slow scan and keeps going in the background', async () => {
    const tarball = await tarBytes(
      Array.from({ length: 40 }, (_, index) => ({
        name: `f${index}.bin`,
        data: mixedData(256 * 1024),
      }))
    )
    const compressed = gzipSync(tarball)
    const slow = remoteStorage(compressed)
    const original = slow.getFileStream.bind(slow)
    slow.getFileStream = async (...args: Parameters<typeof original>) => {
      const stream = await original(...args)
      return Readable.from(
        (async function* () {
          for await (const chunk of stream) {
            await new Promise((resolve) => setTimeout(resolve, 2))
            yield chunk
          }
        })()
      )
    }
    const ref = {
      key: 'progress-test',
      storage: slow,
      path: 'x',
      name: 'x.tar.gz',
      format: 'tar.gz' as const,
    }
    const signal = new AbortController().signal
    const early = await getArchiveIndex(ref, {
      signal,
      wait: 5,
      requester: 'test',
    })
    expect(early.complete).toBe(false)
    const done = await getArchiveIndex(ref, {
      signal,
      wait: 'complete',
      requester: 'test',
    })
    expect(done.complete).toBe(true)
    expect(done.index?.entries).toHaveLength(40)
  })
})

describe('index cache limits', () => {
  /** Storage that accepts a request and never answers. */
  function hangingRef(key: string) {
    const storage = remoteStorage(Buffer.alloc(0))
    storage.getFileSize = () => new Promise(() => {})
    return {
      key,
      storage,
      path: 'x',
      name: 'x.tar.gz',
      format: 'tar.gz' as const,
    }
  }

  it('encodes a finished listing once and reuses it', async () => {
    const bytes = await zipBytes([
      { name: 'a.txt', data: 'a' },
      { name: 'dir/b.txt', data: 'b' },
    ])
    const ref = {
      key: 'encoded-listing',
      storage: remoteStorage(bytes),
      path: 'x',
      name: 'x.zip',
      format: 'zip' as const,
    }
    const list = (after = 0) =>
      archiveListing(ref, {
        progress: false,
        after,
        signal: new AbortController().signal,
        requester: 'test',
        recheck: async () => {},
        confirm: async () => {},
      })
    const first = await list()
    expect(first.headers.get('content-type')).toBe('application/json')
    const body = await first.json()
    expect(body).toEqual({
      success: true,
      data: expect.objectContaining({
        format: 'zip',
        fileCount: 2,
        entries: [
          { path: 'a.txt', type: 'file', size: 1 },
          { path: 'dir/b.txt', type: 'file', size: 1 },
        ],
      }),
    })
    expect(await (await list()).json()).toEqual(body)
    expect((await (await list(1)).json()).data.entries).toEqual([
      { path: 'dir/b.txt', type: 'file', size: 1 },
    ])
    const { index } = await getArchiveIndex(ref, {
      signal: new AbortController().signal,
      wait: 'complete',
      requester: 'test',
    })
    expect(index!.listingJson()).toBe(index!.listingJson())
  })

  it('remembers a failed index briefly instead of reading it again', async () => {
    const stats = { requests: 0, bytes: 0 }
    const ref = {
      key: 'failed-listing',
      storage: remoteStorage(Buffer.alloc(4096, 7), stats),
      path: 'x',
      name: 'x.tar',
      format: 'tar' as const,
    }
    const list = () =>
      getArchiveIndex(ref, {
        signal: new AbortController().signal,
        wait: 'complete',
        requester: 'test',
      })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await expect(list()).rejects.toThrow(/isn’t a readable TAR/)
      const requests = stats.requests
      await expect(list()).rejects.toThrow(/isn’t a readable TAR/)
      expect(stats.requests).toBe(requests)
      vi.advanceTimersByTime(ARCHIVE_INDEX_FAILURE_MS + 1)
      await expect(list()).rejects.toThrow(/isn’t a readable TAR/)
      expect(stats.requests).toBeGreaterThan(requests)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts over after an abandoned index instead of repeating its error', async () => {
    const ref = hangingRef('abandoned-listing')
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    })
    try {
      const options = {
        signal: new AbortController().signal,
        wait: 0,
        requester: 'test',
      }
      const look = async () => {
        const view = getArchiveIndex(ref, options)
        await vi.advanceTimersByTimeAsync(1)
        return view
      }
      expect((await look()).complete).toBe(false)
      // Nobody asks again, so the job stops itself.
      await vi.advanceTimersByTimeAsync(60_000)
      expect((await look()).complete).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('limits how many archives one requester can start reading at once', async () => {
    const options = (requester: string) => ({
      signal: new AbortController().signal,
      wait: 0,
      requester,
    })
    for (let index = 0; index < ARCHIVE_INDEX_JOBS_PER_REQUESTER; index++)
      await getArchiveIndex(hangingRef(`busy-${index}`), options('ip:one'))
    await expect(
      getArchiveIndex(hangingRef('busy-extra'), options('ip:one'))
    ).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('several archives at once'),
    })
    // Joining a job someone already started costs nothing.
    await expect(
      getArchiveIndex(hangingRef('busy-0'), options('ip:one'))
    ).resolves.toMatchObject({ complete: false })
    await expect(
      getArchiveIndex(hangingRef('busy-extra'), options('ip:two'))
    ).resolves.toMatchObject({ complete: false })
  })
})

describe('stalled storage', () => {
  /** A storage stream that never sends a byte and never closes. */
  const silent = () =>
    new Readable({
      read() {},
    })

  it('fails a read that stops receiving bytes instead of waiting forever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const stream = silent()
      const reading = readUpTo(stream, 10)
      const outcome = expect(reading).rejects.toMatchObject({ status: 504 })
      await vi.advanceTimersByTimeAsync(ARCHIVE_IDLE_MS + 1)
      await outcome
      expect(stream.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases an entry request whose storage never answers', async () => {
    const bytes = await tarBytes([
      { name: 'big.bin', data: randomBytes(1024 * 1024) },
    ])
    const storage = remoteStorage(bytes)
    const ref = {
      key: 'stalled-entry',
      storage,
      path: 'x',
      name: 'x.tar',
      format: 'tar' as const,
    }
    await getArchiveIndex(ref, {
      signal: new AbortController().signal,
      wait: 'complete',
      requester: 'test',
    })
    // Storage accepts the request but never responds.
    storage.getFileStream = () => new Promise(() => {})
    const read = () =>
      archiveEntry(
        ref,
        { path: 'big.bin' },
        {
          request: new Request('http://localhost/entry'),
          requester: 'stalled-requester',
          inline: false,
          recheck: async () => {},
          audit: async () => {},
        }
      )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      // More stalled requests than one requester may hold at once.
      for (let attempt = 0; attempt < 10; attempt++) {
        const outcome = expect(read()).rejects.toMatchObject({ status: 504 })
        await vi.advanceTimersByTimeAsync(ARCHIVE_IDLE_MS + 1)
        await outcome
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts decoding toward a range as activity, not a stall', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const stream = silent()
      const reading = readUpTo(stream, 4)
      // Twice the idle limit passes while the slice skips toward its range.
      for (let step = 0; step < 4; step++) {
        await vi.advanceTimersByTimeAsync(ARCHIVE_IDLE_MS / 2)
        stream.emit(SLICE_PROGRESS)
      }
      stream.push(Buffer.from('done'))
      await expect(reading).resolves.toEqual(Buffer.from('done'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a two-part read as soon as it is destroyed', async () => {
    const first = new Readable({ read() {} })
    const second = vi.fn(async () => Readable.from([Buffer.from('second')]))
    const joined = concatStreams([async () => first, second])
    const progress = vi.fn()
    joined.on(SLICE_PROGRESS, progress)
    first.push(Buffer.from('first'))
    joined.resume()
    await once(joined, 'data')
    first.emit(SLICE_PROGRESS)
    expect(progress).toHaveBeenCalledOnce()
    joined.destroy()
    expect(first.destroyed).toBe(true)
    await once(joined, 'close')
    expect(second).not.toHaveBeenCalled()
  })

  it('closes a two-part read whose next part never opens', async () => {
    let deliver!: (part: Readable) => void
    const second = vi.fn(
      () =>
        new Promise<Readable>((resolve) => {
          deliver = resolve
        })
    )
    const joined = concatStreams([
      async () => Readable.from([Buffer.from('first')]),
      second,
    ])
    joined.resume()
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce())
    // Storage hasn't answered; leaving must still close the stream.
    joined.destroy()
    await once(joined, 'close')
    const late = new Readable({ read() {} })
    deliver(late)
    await vi.waitFor(() => expect(late.destroyed).toBe(true))
  })

  it('releases a download stalled while opening the next GZIP member', async () => {
    const tarball = await tarBytes([
      { name: 'first.bin', data: mixedData(3 * 1024 * 1024) },
      { name: 'spanning.bin', data: mixedData(2 * 1024 * 1024) },
    ])
    const spanning = (await indexOf(tarball, 'tar')).index.find('spanning.bin')!
    const split = spanning.offset + 1024 * 1024
    const firstMember = gzipSync(tarball.subarray(0, split))
    const compressed = Buffer.concat([
      firstMember,
      gzipSync(tarball.subarray(split)),
    ])
    const storage = remoteStorage(compressed)
    const { index, source } = await indexOf(
      compressed,
      'tar.gz',
      'stall.tar.gz',
      storage
    )
    // Storage accepts the request for the second member and never answers.
    const open = storage.getFileStream.bind(storage)
    storage.getFileStream = (...args: Parameters<typeof open>) =>
      args[1]?.start === firstMember.length
        ? new Promise(() => {})
        : open(...args)
    const release = vi.fn()
    const leaving = new AbortController()
    const response = await entryResponse({
      source,
      index,
      entry: index.find('spanning.bin')!,
      range: null,
      inline: false,
      release,
      signal: leaving.signal,
    })
    const reader = response.body!.getReader()
    let received = 0
    while (received < split - spanning.offset)
      received += (await reader.read()).value!.length
    expect(release).not.toHaveBeenCalled()
    leaving.abort()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    reader.releaseLock()
  })

  it('stops decoding as soon as a slice is destroyed mid-skip', async () => {
    const data = mixedData(24 * 1024 * 1024)
    const bytes = rawZip([{ name: Buffer.from('big.bin'), data, method: 8 }])
    const storage = remoteStorage(bytes)
    const opened: Readable[] = []
    const open = storage.getFileStream.bind(storage)
    storage.getFileStream = async (...args: Parameters<typeof open>) => {
      const stream = await open(...args)
      opened.push(stream)
      return stream
    }
    const { index, source } = await indexOf(bytes, 'zip', 'big.zip', storage)
    const stream = await openEntryRange(
      source,
      index,
      index.find('big.bin')!,
      data.length - 10,
      data.length
    )
    const input = opened.at(-1)!
    let progress = 0
    stream.on(SLICE_PROGRESS, () => progress++)
    stream.resume()
    await once(stream, SLICE_PROGRESS)
    stream.destroy()
    // The storage stream stops now, not after the skip reaches its range.
    expect(input.destroyed).toBe(true)
    await once(stream, 'close')
    const seen = progress
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(progress).toBe(seen)
  })

  it('stops an indexing job that stalls and frees its slot', async () => {
    const bytes = await zipBytes([{ name: 'a.txt', data: 'a' }])
    const stalled = remoteStorage(bytes)
    stalled.getFileSize = () => new Promise(() => {})
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    })
    try {
      const jobs = Array.from({ length: ARCHIVE_INDEX_CONCURRENCY }, (_, i) =>
        getArchiveIndex(
          {
            key: `stalled-job-${i}`,
            storage: stalled,
            path: 'x',
            name: 'x.zip',
            format: 'zip' as const,
          },
          {
            signal: new AbortController().signal,
            wait: 'complete',
            requester: 'test',
          }
        )
      )
      const outcomes = jobs.map((job) =>
        expect(job).rejects.toMatchObject({ status: 504 })
      )
      await vi.advanceTimersByTimeAsync(
        ARCHIVE_BROWSE_LIMITS.scanMs + ARCHIVE_IDLE_MS + 1
      )
      await Promise.all(outcomes)
    } finally {
      vi.useRealTimers()
    }
    // Both slots are free again: a healthy archive still lists.
    const healthy = await getArchiveIndex(
      {
        key: 'after-stall',
        storage: remoteStorage(bytes),
        path: 'x',
        name: 'x.zip',
        format: 'zip' as const,
      },
      {
        signal: new AbortController().signal,
        wait: 'complete',
        requester: 'test',
      }
    )
    expect(healthy.index?.entries).toHaveLength(1)
  })
})
