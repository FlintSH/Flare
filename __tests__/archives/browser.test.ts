import { describe, expect, it, vi } from 'vitest'

import {
  archiveEntriesAt,
  archiveEntryHref,
  archiveFetch,
  archiveFolderCount,
  archiveListingRequest,
  archiveOutputName,
  archivePreviewKind,
  archiveProfileRequest,
  archiveSelectionSize,
  buildArchiveTree,
  isArchiveCandidate,
  loadArchiveListing,
  readPreviewBytes,
} from '@/components/archives/archive-utils'

import type { ArchiveEntry } from '@/lib/archives/shared'

const entries: ArchiveEntry[] = [
  { path: 'project/docs/Read me.txt', type: 'file', size: 17 },
  { path: 'project/logo.png', type: 'file', size: 100 },
  { path: 'project-old/archive.txt', type: 'file', size: 25 },
  { path: 'empty/', type: 'directory', size: 0 },
]

describe('archive browser navigation', () => {
  it('synthesizes missing folders and confines navigation to exact parent paths', () => {
    expect(
      archiveEntriesAt(entries, '', '').map((entry) => entry.path)
    ).toEqual(['empty', 'project', 'project-old'])
    expect(
      archiveEntriesAt(entries, 'project', '').map((entry) => entry.path)
    ).toEqual(['project/docs', 'project/logo.png'])
    expect(archiveEntriesAt(entries, 'empty', '')).toEqual([])
    expect(archiveFolderCount(entries)).toBe(4)
  })

  it('searches full paths throughout the archive regardless of the open folder', () => {
    expect(
      archiveEntriesAt(entries, 'empty', ' READ ME ').map((entry) => entry.path)
    ).toEqual(['project/docs/Read me.txt'])
    expect(archiveEntriesAt(entries, 'project', 'missing')).toEqual([])
  })

  it('addresses entries by listing position so member names stay out of URLs', () => {
    expect(archiveEntryHref('id/1', { kind: 'owner' }, 3)).toBe(
      '/api/files/id%2F1/archive/entry?entry=3'
    )
    expect(
      archiveEntryHref('id/1', { kind: 'share', password: 'x' }, 0, {
        inline: true,
      })
    ).toBe('/api/files/id%2F1/archive/share/entry?entry=0&disposition=inline')
  })

  it('keeps listing positions for explicit entries, including repeated paths', () => {
    const tree = buildArchiveTree([
      { path: 'a/one.txt', type: 'file', size: 1 },
      { path: 'a/one.txt', type: 'file', size: 2 },
      { path: 'b/', type: 'directory', size: 0 },
    ])
    expect(tree.folderCount).toBe(2)
    expect(tree.children.get('a')).toEqual([
      { path: 'a/one.txt', type: 'file', size: 2, position: 1 },
    ])
    expect(tree.children.get('')?.find((row) => row.path === 'a')).toEqual({
      path: 'a',
      type: 'directory',
      size: 0,
    })
  })

  it('switches archive output formats without stacking extensions', () => {
    expect(archiveOutputName(' Handoff.TAR.GZ ', 'zip')).toBe('Handoff.zip')
    expect(archiveOutputName('Handoff.zip', 'tar.gz')).toBe('Handoff.tar.gz')
    expect(archiveOutputName('', 'zip')).toBe('Archive.zip')
  })

  it('recognizes supported MIME types and gives unsupported archives a useful entry point', () => {
    expect(isArchiveCandidate('download', 'application/zip')).toBe(true)
    expect(isArchiveCandidate('bundle.TGZ', 'application/octet-stream')).toBe(
      true
    )
    expect(isArchiveCandidate('bundle.7z', 'application/octet-stream')).toBe(
      true
    )
    expect(isArchiveCandidate('bundle.rar', 'application/octet-stream')).toBe(
      true
    )
    expect(isArchiveCandidate('photo.png', 'image/png')).toBe(false)
  })
})

describe('archive listing transport', () => {
  it('keeps protected-share credentials in the body and polls with a cursor', async () => {
    const source = { kind: 'share' as const, password: 'demo-only &?+#' }
    const controller = new AbortController()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'))
    try {
      const request = archiveListingRequest('id/1', source, {
        progress: true,
        after: 12,
      })
      await archiveFetch(request.url, request.body, controller.signal)
      const [url, options] = fetchSpy.mock.calls.at(-1)!
      expect(url).toBe('/api/files/id%2F1/archive/share')
      expect(options?.method).toBe('POST')
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(options?.cache).toBe('no-store')
      expect(options?.signal).toBe(controller.signal)
      expect(JSON.parse(options?.body as string)).toEqual({
        password: source.password,
        progress: true,
        after: 12,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('uses the shared route without credentials and keeps library reads on owner routes', () => {
    expect(archiveListingRequest('file', { kind: 'share' })).toEqual({
      url: '/api/files/file/archive/share',
      body: {},
    })
    expect(archiveListingRequest('file', { kind: 'owner' })).toEqual({
      url: '/api/files/file/archive',
    })
    expect(
      archiveListingRequest(
        'file',
        { kind: 'owner' },
        { progress: true, after: 5 }
      )
    ).toEqual({ url: '/api/files/file/archive?progress=1&after=5' })
  })

  it('accumulates entries while the server is still reading the archive', async () => {
    const responses = [
      Response.json(
        {
          success: true,
          data: {
            status: 'indexing',
            format: 'tar.gz',
            archiveBytes: 100,
            bytesRead: 40,
            entries: [{ path: 'a.txt', type: 'file', size: 1 }],
            entriesFound: 1,
          },
        },
        { status: 202 }
      ),
      Response.json({
        success: true,
        data: {
          format: 'tar.gz',
          entries: [{ path: 'b.txt', type: 'file', size: 2 }],
          fileCount: 2,
          totalBytes: 3,
          archiveBytes: 100,
          entryCount: 2,
          truncated: null,
          extraction: { available: true },
        },
      }),
    ]
    vi.useFakeTimers()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responses.shift()!)
    try {
      const updates: string[] = []
      const loading = loadArchiveListing(
        'id',
        { kind: 'owner' },
        {
          signal: new AbortController().signal,
          onUpdate: (update) => updates.push(update.status),
        }
      )
      await vi.advanceTimersByTimeAsync(1000)
      const listing = await loading
      expect(updates).toEqual(['indexing'])
      expect(listing.entries.map((entry) => entry.path)).toEqual([
        'a.txt',
        'b.txt',
      ])
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
        '/api/files/id/archive?progress=1',
        '/api/files/id/archive?progress=1&after=1',
      ])
    } finally {
      fetchSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('archive profile snapshots', () => {
  it('pins explicit output settings to the displayed profile and refuses loading or stale selections', () => {
    const snapshot = {
      id: 'private-profile',
      revision: '2026-10-06T00:00:00.000Z',
      effectiveRevision: 'a'.repeat(64),
    }
    expect(archiveProfileRequest('private-profile', snapshot)).toEqual({
      profileId: 'private-profile',
      profileRevision: snapshot.revision,
      profileEffectiveRevision: snapshot.effectiveRevision,
    })
    expect(() => archiveProfileRequest('private-profile', null)).toThrow(
      'Wait for'
    )
    expect(() => archiveProfileRequest('different-profile', snapshot)).toThrow(
      'Wait for'
    )
    expect(() =>
      archiveProfileRequest('private-profile', {
        ...snapshot,
        effectiveRevision: '',
      })
    ).toThrow('Wait for')
    expect(archiveProfileRequest(null, snapshot)).toEqual({ profileId: null })
  })
})

describe('library-to-archive size units', () => {
  it('converts MiB metadata and enforces aggregate and per-file byte limits', () => {
    expect(archiveSelectionSize([{ size: 0.5 }, { size: 1.25 }])).toEqual({
      totalBytes: 1835008,
      overLimit: false,
    })
    expect(archiveSelectionSize([{ size: 256 }, { size: 256 }]).overLimit).toBe(
      false
    )
    expect(
      archiveSelectionSize([
        { size: 256 },
        { size: 256 },
        { size: 1 / 1024 ** 2 },
      ]).overLimit
    ).toBe(true)
    expect(archiveSelectionSize([{ size: 257 }]).overLimit).toBe(true)
  })
})

describe('safe bounded archive previews', () => {
  it('treats active document formats as plain text and recognizes streamable media', () => {
    expect(archivePreviewKind('untrusted.svg')).toEqual({ type: 'text' })
    expect(archivePreviewKind('index.HTML')).toEqual({ type: 'text' })
    expect(archivePreviewKind('folder/Makefile')).toEqual({ type: 'text' })
    expect(archivePreviewKind('payload.exe')).toBeNull()
    expect(archivePreviewKind('clip.MP4')).toEqual({ type: 'video' })
    expect(archivePreviewKind('song.flac')).toEqual({ type: 'audio' })
    expect(archivePreviewKind('photo.jpeg')).toEqual({ type: 'image' })
  })

  it('stops and cancels an oversized body without trusting Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6, 7, 8]))
      },
      cancel() {
        cancelled = true
      },
    })
    const result = await readPreviewBytes(
      new Response(body, { headers: { 'Content-Length': '1' } }),
      5
    )
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(result.truncated).toBe(true)
    expect(cancelled).toBe(true)
  })

  it('does not label an exact-limit or empty file as truncated', async () => {
    expect(
      await readPreviewBytes(new Response(new Uint8Array([1, 2, 3])), 3)
    ).toEqual({ bytes: new Uint8Array([1, 2, 3]), truncated: false })
    expect(await readPreviewBytes(new Response(''), 3)).toEqual({
      bytes: new Uint8Array(),
      truncated: false,
    })
  })

  it('propagates a body read failure rather than showing a complete-looking partial preview', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('Interrupted download'))
      },
    })
    await expect(readPreviewBytes(new Response(body), 10)).rejects.toThrow(
      'Interrupted download'
    )
  })
})
