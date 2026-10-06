import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32, createGzip, gzipSync } from 'node:zlib'
import * as tar from 'tar-stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createArchive,
  readArchive,
  validateArchivePath,
} from '@/lib/archives/codec'
import { ARCHIVE_LIMITS, detectArchiveFormat } from '@/lib/archives/shared'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'flare-archive-test-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function file(bytes: Buffer, name = 'fixture.zip') {
  const path = join(directory, randomUUID())
  await writeFile(path, bytes)
  return { path, name }
}

/** A real stored ZIP fixture; no writer sanitizes the intentionally hostile paths. */
function zip(
  items: {
    name: string
    data?: Buffer
    flags?: number
    mode?: number
    declaredSize?: number
    crc?: number
    method?: number
  }[]
) {
  const contents: Buffer[] = []
  const index: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const name = Buffer.from(item.name)
    const data = item.data ?? Buffer.alloc(0)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(item.flags ?? 0x800, 6)
    local.writeUInt16LE(item.method ?? 0, 8)
    local.writeUInt32LE(item.crc ?? crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(item.declaredSize ?? data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    local.copy(central, 6, 4, 28)
    central.writeUInt32LE(
      ((item.mode ?? (item.name.endsWith('/') ? 0o040755 : 0o100644)) *
        65536) >>>
        0,
      38
    )
    central.writeUInt32LE(offset, 42)
    contents.push(local, name, data)
    index.push(central, name)
    offset += local.length + name.length + data.length
  }
  const central = Buffer.concat(index)
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
    data?: string
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

describe('archive format detection and paths', () => {
  it('recognizes supported formats without treating every ZIP-based document as an archive', () => {
    expect(detectArchiveFormat('Project.TGZ')).toBe('tar.gz')
    expect(detectArchiveFormat('logs.txt.gz')).toBe('gzip')
    expect(detectArchiveFormat('upload', 'application/x-zip-compressed')).toBe(
      'zip'
    )
    expect(
      detectArchiveFormat(
        'report.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBeNull()
    expect(detectArchiveFormat('project.7z')).toBeNull()
  })
  it.each([
    '../secret',
    '/absolute',
    'C:/secret',
    'a\\b',
    'a/../b',
    'a//b',
    'a\u0000b',
    'a\u202eb',
    'x/'.repeat(20) + 'file',
    'x'.repeat(256),
    'x'.repeat(81) + '/file',
    'a/．/b',
    'a/：b',
  ])('rejects unsafe or unrepresentable path %j', (name) => {
    expect(() => validateArchivePath(name)).toThrow()
  })
  it('accepts conventional TAR prefixes and preserves nested names', () => {
    expect(validateArchivePath('./photos/Trip.jpg')).toBe('photos/Trip.jpg')
    expect(validateArchivePath('./', true)).toBe('')
  })
})

describe('reading and staging archive contents', () => {
  it('verifies ZIP bytes and stages safely while retaining empty files and directories', async () => {
    const fixture = await file(
      zip([
        { name: 'docs/readme.txt', data: Buffer.from('Hello archive') },
        { name: 'empty/' },
        { name: 'zero.txt' },
      ])
    )
    const staging = join(directory, 'staging')
    await mkdir(staging)
    const manifest = await readArchive(fixture.path, fixture.name, {
      directory: staging,
    })
    expect(manifest).toMatchObject({
      format: 'zip',
      totalBytes: 13,
      fileCount: 2,
    })
    expect(manifest.entries.map(({ path }) => path)).toEqual([
      'docs/readme.txt',
      'empty',
      'zero.txt',
    ])
    const first = manifest.entries[0]
    expect(first.diskPath).toMatch(new RegExp('^' + staging + '/[a-f0-9-]+$'))
    expect(await readFile(first.diskPath!, 'utf8')).toBe('Hello archive')
    expect((await stat(first.diskPath!)).mode & 0o777).toBe(0o600)
    expect(manifest.entries[1].diskPath).toBeUndefined()
    expect((await stat(manifest.entries[2].diskPath!)).size).toBe(0)
  })
  it.each(['tar', 'tar.gz', 'tgz'])(
    'reads %s with subdirectories and no extraction to archive-supplied disk paths',
    async (extension) => {
      const bytes = await tarBytes([
        { name: './', type: 'directory' },
        { name: './assets/', type: 'directory' },
        { name: './assets/note.txt', data: 'Nested contents' },
      ])
      const fixture = await file(
        extension === 'tar' ? bytes : gzipSync(bytes),
        `project.${extension}`
      )
      const result = await readArchive(fixture.path, fixture.name)
      expect(result.fileCount).toBe(1)
      expect(result.totalBytes).toBe(15)
      expect(result.entries).toEqual([
        { path: 'assets', type: 'directory', size: 0 },
        { path: 'assets/note.txt', type: 'file', size: 15 },
      ])
    }
  )
  it('reads single-file GZIP and verifies its checksum', async () => {
    const bytes = gzipSync('log contents')
    const fixture = await file(bytes, 'debug.log.gz')
    expect(await readArchive(fixture.path, fixture.name)).toMatchObject({
      format: 'gzip',
      entries: [{ path: 'debug.log', size: 12 }],
      totalBytes: 12,
    })
    bytes[bytes.length - 8] ^= 0xff
    await writeFile(fixture.path, bytes)
    await expect(readArchive(fixture.path, fixture.name)).rejects.toThrow(
      'damaged'
    )
  })
  it('allows an empty ZIP and TAR', async () => {
    for (const [name, bytes] of [
      ['empty.zip', zip([])],
      ['empty.tar', await tarBytes([])],
    ] as const) {
      const fixture = await file(bytes, name)
      expect((await readArchive(fixture.path, name)).fileCount).toBe(0)
    }
  })
  it.each(
    [
      [{ name: '../outside.txt' }],
      [{ name: 'name.txt', data: Buffer.from('data'), crc: 0 }],
      [{ name: 'link', mode: 0o120777 }],
      [{ name: 'encrypted.txt', flags: 1 }],
      [{ name: 'file.txt', method: 99 }],
      [{ name: 'same.txt' }, { name: 'same.txt' }],
      [{ name: 'A.txt' }, { name: 'a.txt' }],
      [{ name: 'a' }, { name: 'a/nested.txt' }],
      [{ name: 'Week 1/a' }, { name: 'Week  1/b' }],
      [{ name: 'Ｗork/a' }, { name: 'Work/b' }],
      [{ name: 'folder/', data: Buffer.from('unexpected') }],
      [{ name: 'big', declaredSize: ARCHIVE_LIMITS.fileBytes + 1 }],
    ].map((entries) => ({ entries }))
  )(
    'rejects hostile ZIP entries %# without publishing a manifest',
    async ({ entries }) => {
      const fixture = await file(zip(entries))
      await expect(readArchive(fixture.path, fixture.name)).rejects.toThrow()
    }
  )
  it.each(['symlink', 'link', 'fifo', 'character-device'] as const)(
    'rejects TAR %s members',
    async (type) => {
      const fixture = await file(
        await tarBytes([{ name: 'unsafe', type, linkname: '/etc/passwd' }]),
        'unsafe.tar'
      )
      await expect(readArchive(fixture.path, fixture.name)).rejects.toThrow(
        'links or special'
      )
    }
  )
  it('rejects too many entries and implied parent directories', async () => {
    const many = await file(
      zip(Array.from({ length: 1001 }, (_, i) => ({ name: `file-${i}` })))
    )
    await expect(readArchive(many.path, many.name)).rejects.toThrow('1,000')
    const deep = await file(
      zip(
        Array.from({ length: 501 }, (_, i) => ({ name: `directory-${i}/file` }))
      )
    )
    await expect(readArchive(deep.path, deep.name)).rejects.toThrow('1,000')
  })
  it('rejects oversized inputs before reading their sparse contents', async () => {
    const fixture = await file(Buffer.alloc(0))
    await truncate(fixture.path, ARCHIVE_LIMITS.archiveBytes + 1)
    await expect(readArchive(fixture.path, fixture.name)).rejects.toThrow(
      '256 MiB'
    )
  })
  it('bounds actual GZIP expansion without relying on declared metadata', async () => {
    const fixture = await file(Buffer.alloc(0), 'bomb.gz')
    const chunk = Buffer.alloc(1024 ** 2)
    await pipeline(
      Readable.from(
        (async function* () {
          for (let i = 0; i < 257; i++) yield chunk
        })()
      ),
      createGzip(),
      createWriteStream(fixture.path)
    )
    await expect(readArchive(fixture.path, fixture.name)).rejects.toThrow(
      '256 MiB'
    )
  }, 15000)
  it('rejects truncated ZIP/TAR and respects a cancelled operation', async () => {
    const tarContent = await tarBytes([{ name: 'hello', data: 'message' }])
    for (const [name, bytes] of [
      ['broken.zip', zip([{ name: 'test' }]).subarray(0, 40)],
      ['broken.tar', tarContent.subarray(0, 514)],
      ['footer.tar', tarContent.subarray(0, 1024)],
      ['empty.tar.gz', gzipSync('')],
    ] as const) {
      const fixture = await file(bytes, name)
      await expect(readArchive(fixture.path, name)).rejects.toThrow()
    }
    const fixture = await file(zip([{ name: 'test' }]))
    await expect(
      readArchive(fixture.path, fixture.name, { signal: AbortSignal.abort() })
    ).rejects.toThrow()
  })
})

describe('archive creation', () => {
  it.each(['zip', 'tar.gz'] as const)(
    'creates a %s that round-trips the exact selected bytes',
    async (format) => {
      const source = await file(Buffer.from('Archive round trip'))
      const output = join(directory, `created.${format}`)
      await createArchive(output, format, [
        { path: 'hello.txt', localPath: source.path, size: 18 },
      ])
      const manifest = await readArchive(output, `created.${format}`, {
        directory,
      })
      expect(manifest.fileCount).toBe(1)
      expect(await readFile(manifest.entries[0].diskPath!, 'utf8')).toBe(
        'Archive round trip'
      )
      expect(await readFile(source.path, 'utf8')).toBe('Archive round trip')
    }
  )
  it('fails if any source is missing or changes size; never silently omits it', async () => {
    const source = await file(Buffer.from('test'))
    const output = join(directory, 'created.zip')
    await expect(
      createArchive(output, 'zip', [
        { path: 'test.txt', localPath: source.path, size: 3 },
      ])
    ).rejects.toThrow('changed')
    await expect(
      createArchive(join(directory, 'missing.zip'), 'zip', [
        { path: 'missing.txt', localPath: join(directory, 'absent'), size: 0 },
      ])
    ).rejects.toThrow()
  })
})
