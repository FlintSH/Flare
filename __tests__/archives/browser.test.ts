import { describe, expect, it } from 'vitest'

import {
  archiveEntriesAt,
  archiveEntryUrl,
  archiveFolderCount,
  archiveOutputName,
  archivePreviewKind,
  archiveProfileRequest,
  archiveSelectionSize,
  isArchiveCandidate,
  isSafeArchiveImage,
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

  it('encodes entry paths independently from route identifiers', () => {
    expect(archiveEntryUrl('id/1', 'folder/a #?&ü.txt')).toBe(
      '/api/files/id%2F1/archive/entry?path=folder%2Fa%20%23%3F%26%C3%BC.txt'
    )
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

describe('archive profile snapshots', () => {
  it('pins explicit output settings to the displayed profile and refuses loading or stale selections', () => {
    const snapshot = {
      id: 'private-profile',
      revision: '2026-10-06T00:00:00.000Z',
    }
    expect(archiveProfileRequest('private-profile', snapshot)).toEqual({
      profileId: 'private-profile',
      profileRevision: snapshot.revision,
    })
    expect(() => archiveProfileRequest('private-profile', null)).toThrow(
      'Wait for'
    )
    expect(() => archiveProfileRequest('different-profile', snapshot)).toThrow(
      'Wait for'
    )
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
  it('treats active document formats as plain text and requires verified raster MIME', () => {
    expect(archivePreviewKind('untrusted.svg')).toEqual({ type: 'text' })
    expect(archivePreviewKind('index.HTML')).toEqual({ type: 'text' })
    expect(archivePreviewKind('payload.exe')).toBeNull()
    expect(isSafeArchiveImage('image/png')).toBe(true)
    expect(isSafeArchiveImage('image/jpeg; charset=binary')).toBe(true)
    expect(isSafeArchiveImage('application/octet-stream')).toBe(false)
    expect(isSafeArchiveImage('image/svg+xml')).toBe(false)
    expect(isSafeArchiveImage('text/html')).toBe(false)
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
