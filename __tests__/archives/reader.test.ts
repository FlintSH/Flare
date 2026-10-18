import archiver from 'archiver'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'
import * as tar from 'tar-stream'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ArchiveIndex,
  assessExtraction,
  normalizeBrowsePath,
} from '@/lib/archives/archive-index'
import { openByteSource } from '@/lib/archives/byte-source'
import { openEntryRange } from '@/lib/archives/entry-reader'
import { parseByteRange } from '@/lib/archives/entry-response'
import { GzipSeekIndex, inflateIndexed } from '@/lib/archives/gzip-reader'
import {
  buildArchiveIndex,
  clearArchiveIndexCache,
  getArchiveIndex,
} from '@/lib/archives/index-cache'
import type { ArchiveFormat } from '@/lib/archives/shared'
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
    const { openGzipRange } = await import('@/lib/archives/gzip-reader')
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
      getArchiveIndex(ref, { signal, wait: 'complete' }),
      getArchiveIndex(ref, { signal, wait: 'complete' }),
    ])
    expect(first.index).toBe(second.index)
    const requests = stats.requests
    const third = await getArchiveIndex(ref, { signal, wait: 'complete' })
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
    const early = await getArchiveIndex(ref, { signal, wait: 5 })
    expect(early.complete).toBe(false)
    const done = await getArchiveIndex(ref, { signal, wait: 'complete' })
    expect(done.complete).toBe(true)
    expect(done.index?.entries).toHaveLength(40)
  })
})
