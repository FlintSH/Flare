import { describe, expect, it } from 'vitest'
import yauzl from 'yauzl'

import type { EncryptedRecordsWire, OpenedFile } from '@/lib/e2ee/client/files'
import { E2eeError } from '@/lib/e2ee/errors'
import { HEADER_LENGTH, STORED_CHUNK_SIZE } from '@/lib/e2ee/file'
import { base64urlEncode } from '@/lib/e2ee/primitives'
import {
  type ExportManifest,
  type ExportProgress,
  type ExportSummary,
  type ManifestFile,
  exportArchive,
  exportFilename,
  planExport,
} from '@/lib/users/export-client'

import {
  encrypted,
  expectSameBytes,
  fakeServer,
  fileKey,
  header,
  plaintextOf,
} from '../e2ee/sw/support'
import { collect } from '../e2ee/test-support'

async function unzip(archive: Uint8Array) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(
      Buffer.from(archive),
      { lazyEntries: true },
      (error, file) => (error ? reject(error) : resolve(file))
    )
  )
  const entries = new Map<string, Buffer>()
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, async (error, stream) => {
        if (error) return reject(error)
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        entries.set(entry.fileName, Buffer.concat(chunks))
        zip.readEntry()
      })
    })
    zip.on('end', resolve)
    zip.on('error', reject)
    zip.readEntry()
  })
  return entries
}

/** The records of a file are opaque here: the fake `open` maps them to a name. */
const records = (id: string) => ({
  header: base64urlEncode(header),
  sealedMetadata: id,
  accountStanza: id,
  stanzaAccountPublicKey: 'key',
})

function encryptedFile(
  id: string,
  stored: Uint8Array,
  day = '2026-10-01'
): ManifestFile {
  return {
    id,
    urlPath: `/alexm/e_${id}`,
    sizeBytes: stored.length,
    uploadedAt: `${day}T12:00:00.000Z`,
    encrypted: true,
    name: null,
    encryption: records(id),
  }
}

function plainFile(
  name: string,
  bytes: Uint8Array,
  day = '2026-10-01'
): ManifestFile {
  return {
    id: `plain-${name}`,
    urlPath: `/alexm/${name}`,
    sizeBytes: bytes.length,
    uploadedAt: `${day}T08:00:00.000Z`,
    encrypted: false,
    name,
  }
}

function manifestOf(files: ManifestFile[]): ExportManifest {
  return {
    record: {
      id: 'user-1',
      name: 'Alex',
      email: 'alex@example.test',
      files: files.map((file) =>
        file.encrypted
          ? { name: '', mimeType: 'application/octet-stream', encrypted: true }
          : { name: file.name, mimeType: 'text/plain' }
      ),
      shortenedUrls: [{ shortCode: 'abc', targetUrl: 'https://example.test' }],
    },
    files,
  }
}

function opener(names: Record<string, string | null>) {
  return async (wire: EncryptedRecordsWire): Promise<OpenedFile> => {
    const name = names[wire.sealedMetadata]
    if (name == null) throw new E2eeError('tag_mismatch', 'No key opens it')
    return {
      fileKey,
      headerHash: new Uint8Array(32) as OpenedFile['headerHash'],
      name,
      type: name.endsWith('.png') ? 'image/png' : 'text/plain',
    }
  }
}

async function build(
  files: ManifestFile[],
  stored: Record<string, Uint8Array>,
  names: Record<string, string | null>
) {
  const server = fakeServer(
    Object.fromEntries(
      Object.entries(stored).map(([path, bytes]) => [
        `/api/files${path}`,
        bytes,
      ])
    )
  )
  const plan = await planExport(manifestOf(files), opener(names))
  const progress: ExportProgress[] = []
  let summary: ExportSummary | null = null
  const zip = await collect(
    exportArchive(plan, {
      fetch: server.fetch,
      signal: new AbortController().signal,
      onProgress: (event) => progress.push(event),
      onDone: (result) => {
        summary = result
      },
    })
  )
  return {
    plan,
    entries: await unzip(zip),
    progress,
    summary: summary as ExportSummary | null,
    server,
  }
}

describe('the export a browser builds', () => {
  it('holds decrypted files under their sealed names, plain files as they are, and the account record', async () => {
    const photo = plaintextOf(200_000)
    const notes = plaintextOf(3 * 65536)
    const plain = Buffer.from('a plain file\n')
    const files = [
      encryptedFile('photo', await encrypted(photo)),
      plainFile('public-notes.txt', plain),
      encryptedFile('notes', await encrypted(notes), '2026-10-02'),
    ]
    const { entries, summary, plan, progress } = await build(
      files,
      {
        '/alexm/e_photo': await encrypted(photo),
        '/alexm/public-notes.txt': plain,
        '/alexm/e_notes': await encrypted(notes),
      },
      { photo: 'harbor sunrise.png', notes: 'meeting notes.txt' }
    )
    expect([...entries.keys()]).toEqual([
      'user-data.json',
      'files/2026-10-01/harbor sunrise.png',
      'files/2026-10-01/public-notes.txt',
      'files/2026-10-02/meeting notes.txt',
      'export-report.json',
    ])
    expectSameBytes(entries.get('files/2026-10-01/harbor sunrise.png')!, photo)
    expectSameBytes(entries.get('files/2026-10-02/meeting notes.txt')!, notes)
    expectSameBytes(entries.get('files/2026-10-01/public-notes.txt')!, plain)

    const data = JSON.parse(entries.get('user-data.json')!.toString())
    expect(data).toMatchObject({
      id: 'user-1',
      email: 'alex@example.test',
      shortenedUrls: [{ shortCode: 'abc' }],
    })
    expect(data.files).toEqual([
      {
        name: 'harbor sunrise.png',
        mimeType: 'image/png',
        encrypted: true,
        exportPath: 'files/2026-10-01/harbor sunrise.png',
        decrypted: true,
      },
      {
        name: 'public-notes.txt',
        mimeType: 'text/plain',
        exportPath: 'files/2026-10-01/public-notes.txt',
      },
      {
        name: 'meeting notes.txt',
        mimeType: 'text/plain',
        encrypted: true,
        exportPath: 'files/2026-10-02/meeting notes.txt',
        decrypted: true,
      },
    ])
    expect(summary).toEqual({
      files: 3,
      decrypted: 2,
      plain: 1,
      notDecrypted: [],
      failed: [],
    })
    const report = JSON.parse(entries.get('export-report.json')!.toString())
    expect(report).toMatchObject({
      files: 3,
      decrypted: 2,
      plain: 1,
      failed: [],
    })
    expect(typeof report.exportedAt).toBe('string')
    expect(plan.totalBytes).toBe(
      files.reduce((sum, file) => sum + file.sizeBytes, 0)
    )
    expect(progress.at(-1)).toMatchObject({
      filesDone: 3,
      filesTotal: 3,
      bytesDone: plan.totalBytes,
      skipped: 0,
    })
  })

  it('numbers names that repeat on one day, across plain and decrypted files', async () => {
    const one = plaintextOf(10)
    const two = plaintextOf(20)
    const plain = Buffer.from('plain')
    const { entries } = await build(
      [
        encryptedFile('a', await encrypted(one)),
        plainFile('report.pdf', plain),
        encryptedFile('b', await encrypted(two)),
        encryptedFile('c', await encrypted(two), '2026-11-05'),
      ],
      {
        '/alexm/e_a': await encrypted(one),
        '/alexm/report.pdf': plain,
        '/alexm/e_b': await encrypted(two),
        '/alexm/e_c': await encrypted(two),
      },
      { a: 'report.pdf', b: 'Report.PDF', c: 'report.pdf' }
    )
    expect(
      [...entries.keys()].filter((name) => name.startsWith('files/'))
    ).toEqual([
      'files/2026-10-01/report.pdf',
      'files/2026-10-01/report (2).pdf',
      'files/2026-10-01/Report (3).PDF',
      'files/2026-11-05/report.pdf',
    ])
  })

  it.each([
    ['../../../etc/passwd', 'passwd'],
    ['C:\\Users\\alex\\secret.txt', 'secret.txt'],
    ['/absolute/path/name.txt', 'name.txt'],
    ['evil\u202Egpj.exe', 'evilgpj.exe'],
    ['line\nbreak\u0000.txt', 'linebreak.txt'],
    ['...', 'file'],
    ['con', '_con'],
    ['<script>alert(1)</script>.html', 'script_.html'],
  ])('makes the sealed name %j one safe path segment', async (sealed, safe) => {
    const bytes = plaintextOf(5)
    const { entries } = await build(
      [encryptedFile('x', await encrypted(bytes))],
      { '/alexm/e_x': await encrypted(bytes) },
      { x: sealed }
    )
    const paths = [...entries.keys()].filter((name) =>
      name.startsWith('files/')
    )
    expect(paths).toEqual([`files/2026-10-01/${safe}`])
    for (const path of paths) {
      expect(path.split('/')).toHaveLength(3)
      expect(path).not.toMatch(/\.\.|[\\\u0000-\u001f\u202e]/)
    }
  })

  it('writes a file no key opens as ciphertext, named by its file ID', async () => {
    const bytes = plaintextOf(100)
    const stored = await encrypted(bytes)
    const { entries, summary } = await build(
      [encryptedFile('AAAAAAAAAAAAAAAAAAAAAA', stored)],
      { '/alexm/e_AAAAAAAAAAAAAAAAAAAAAA': stored },
      { AAAAAAAAAAAAAAAAAAAAAA: null }
    )
    const path = 'files/2026-10-01/e_AAAAAAAAAAAAAAAAAAAAAA.flare-encrypted'
    expectSameBytes(entries.get(path)!, stored)
    expect(summary).toMatchObject({
      files: 1,
      decrypted: 0,
      notDecrypted: [path],
    })
    const data = JSON.parse(entries.get('user-data.json')!.toString())
    expect(data.files[0]).toMatchObject({
      name: '',
      encrypted: true,
      exportPath: path,
      decrypted: false,
    })
  })

  it('leaves out a file that fails its integrity check, says so, and goes on', async () => {
    const good = plaintextOf(70_000)
    const bad = plaintextOf(4 * 65536)
    const damaged = await encrypted(bad)
    damaged[HEADER_LENGTH + 2 * STORED_CHUNK_SIZE + 5] ^= 1
    const cut = (await encrypted(bad)).slice(
      0,
      HEADER_LENGTH + 2 * STORED_CHUNK_SIZE
    )
    const { entries, summary, progress } = await build(
      [
        encryptedFile('damaged', damaged),
        encryptedFile('cut', cut),
        encryptedFile('good', await encrypted(good)),
        plainFile('missing.txt', Buffer.from('gone')),
      ],
      {
        '/alexm/e_damaged': damaged,
        '/alexm/e_cut': cut,
        '/alexm/e_good': await encrypted(good),
      },
      { damaged: 'damaged.bin', cut: 'cut.bin', good: 'good.bin' }
    )
    expect([...entries.keys()]).toEqual([
      'user-data.json',
      'files/2026-10-01/good.bin',
      'export-report.json',
    ])
    expectSameBytes(entries.get('files/2026-10-01/good.bin')!, good)
    expect(summary!.files).toBe(1)
    expect(summary!.failed.map((item) => item.path)).toEqual([
      'files/2026-10-01/damaged.bin',
      'files/2026-10-01/cut.bin',
      'files/2026-10-01/missing.txt',
    ])
    expect(summary!.failed[0].reason).toMatch(/integrity check/)
    expect(summary!.failed[1].reason).toMatch(/integrity check/)
    expect(summary!.failed[2].reason).toMatch(/did not send/)
    const report = JSON.parse(entries.get('export-report.json')!.toString())
    expect(report.failed).toHaveLength(3)
    expect(progress.at(-1)).toMatchObject({ filesDone: 4, skipped: 3 })
  })

  it('stops when it is cancelled, and reads no more files', async () => {
    const bytes = plaintextOf(40 * 65536)
    const stored = await encrypted(bytes)
    const server = fakeServer({
      '/api/files/alexm/e_one': stored,
      '/api/files/alexm/e_two': stored,
    })
    const plan = await planExport(
      manifestOf([encryptedFile('one', stored), encryptedFile('two', stored)]),
      opener({ one: 'one.bin', two: 'two.bin' })
    )
    const abort = new AbortController()
    const archive = exportArchive(plan, {
      fetch: server.fetch,
      signal: abort.signal,
    })
    await archive.next()
    await archive.next()
    abort.abort()
    await expect(collect(archive)).rejects.toThrow()
    expect(
      server.requests.some((request) => request.url.includes('e_two'))
    ).toBe(false)
  })

  it('asks the server only for ciphertext addresses', async () => {
    const bytes = plaintextOf(1000)
    const stored = await encrypted(bytes)
    const { server } = await build(
      [encryptedFile('s', stored)],
      { '/alexm/e_s': stored },
      { s: 'very-secret-name.txt' }
    )
    for (const request of server.requests) {
      expect(request.url).toBe('/api/files/alexm/e_s')
      expect(JSON.stringify(request)).not.toContain('very-secret-name')
    }
  })

  it('names the saved file as the server export does', () => {
    expect(exportFilename(1767225600000)).toBe(
      'flare-data-export-1767225600000.zip'
    )
  })
})
