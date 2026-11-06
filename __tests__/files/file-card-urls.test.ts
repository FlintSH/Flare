import React from 'react'

import type { FileType } from '@/types/components/file'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { FileCard } from '@/components/dashboard/file-card'

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'owner', permissions: ['files.share'] } },
    status: 'authenticated',
  }),
}))

const file: FileType = {
  id: 'cmfilecard0001',
  name: 'photo.png',
  urlPath: '/Ab3dE/photo.png',
  mimeType: 'image/png',
  visibility: 'PUBLIC',
  hasPassword: false,
  size: 1,
  uploadedAt: '2026-10-01T00:00:00.000Z',
  views: 0,
  downloads: 0,
}

const render = (overrides: Partial<FileType> = {}) =>
  renderToStaticMarkup(
    React.createElement(FileCard, { file: { ...file, ...overrides } })
  )

const thumbnail = (html: string) =>
  /<img[^>]* src="([^"]+)"/.exec(html)?.[1].replaceAll('&amp;', '&')

describe('library file card addresses', () => {
  it('links the share page, download and thumbnail of a file', () => {
    const html = render()
    expect(html).toContain('href="/Ab3dE/photo.png"')
    expect(html).toContain('href="/api/files/cmfilecard0001/download"')
    expect(thumbnail(html)).toContain(
      encodeURIComponent('/api/files/cmfilecard0001/thumbnail')
    )
  })

  it('opens a name from an earlier build instead of a cut-short path', () => {
    // A browser read the `#` as the start of a fragment, so the card opened
    // `/Ab3dE/notes.h`.
    const html = render({ urlPath: '/Ab3dE/notes.h#ml', mimeType: 'text/html' })
    expect(html).toContain('href="/Ab3dE/notes.h%23ml"')
    expect(html).not.toContain('href="/Ab3dE/notes.h"')
  })

  it('lets the image optimizer resize only thumbnails anyone may read', () => {
    const optimized = thumbnail(render())
    expect(optimized).toMatch(/^\/_next\/image\?url=/)
    for (const overrides of [
      { visibility: 'PRIVATE' as const },
      { hasPassword: true },
      { mimeType: 'image/gif' },
    ])
      expect(thumbnail(render(overrides)), JSON.stringify(overrides)).toBe(
        '/api/files/cmfilecard0001/thumbnail'
      )
  })
})
