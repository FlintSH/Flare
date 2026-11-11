import { describe, expect, it } from 'vitest'

import {
  DOWNLOAD_BLOB_TYPE,
  INLINE_PREVIEW_MAX_BYTES,
  canPreviewSandboxedPdf,
  normalizedType,
  safeFileName,
  safeRendering,
} from '@/lib/files/safe-render'

describe('renderer allowlist for decrypted content', () => {
  it('draws raster images with an <img> and a fixed raster type', () => {
    expect(safeRendering({ type: 'image/png' })).toEqual({
      renderer: 'image',
      blobType: 'image/png',
    })
    expect(safeRendering({ type: 'IMAGE/JPG; charset=x' })).toEqual({
      renderer: 'image',
      blobType: 'image/jpeg',
    })
  })

  it('gives SVG its own renderer, never the raster or the text one', () => {
    expect(safeRendering({ name: 'a.svg', type: 'image/svg+xml' })).toEqual({
      renderer: 'svg',
      blobType: 'image/svg+xml',
    })
  })

  it('shows markup and script as text, whatever the type claims', () => {
    for (const type of [
      'text/html',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'text/javascript',
      'application/javascript',
    ]) {
      const rendering = safeRendering({ name: 'page.html', type })
      expect(
        rendering.renderer === 'text' || rendering.renderer === 'download',
        type
      ).toBe(true)
    }
    expect(safeRendering({ name: 'x.html', type: 'text/html' })).toEqual({
      renderer: 'text',
      language: 'html',
    })
  })

  it('never lets a name turn a non-text type into a page', () => {
    // An HTML or SVG name with a generic or unknown type is text or a
    // download: no renderer opens it as a document.
    for (const name of ['x.html', 'x.svg', 'x.xhtml', 'x.htm', 'x.xml'])
      for (const type of ['application/octet-stream', '', 'foo/bar', 'x']) {
        const rendering = safeRendering({ name, type })
        expect(['text', 'download'], `${name} ${type}`).toContain(
          rendering.renderer
        )
      }
  })

  it('offers every type that is not on the list as a download', () => {
    for (const type of [
      'application/zip',
      'application/x-msdownload',
      'application/x-shockwave-flash',
      'image/tiff',
      'image/x-xbitmap',
      'video/x-flv',
      'audio/midi',
      'model/gltf+json',
      'font/woff2',
      'multipart/x-mixed-replace',
      'message/rfc822',
      'application/vnd.ms-excel',
      '',
    ])
      expect(safeRendering({ type }), type).toEqual({ renderer: 'download' })
    for (const type of [null, undefined, 42, {}, ['image/png']])
      expect(safeRendering({ type })).toEqual({ renderer: 'download' })
  })

  it('maps media and PDF to their elements with fixed types', () => {
    expect(safeRendering({ type: 'video/webm' })).toEqual({
      renderer: 'video',
      blobType: 'video/webm',
    })
    expect(safeRendering({ type: 'audio/x-wav' })).toEqual({
      renderer: 'audio',
      blobType: 'audio/wav',
    })
    expect(safeRendering({ type: 'application/pdf' })).toEqual({
      renderer: 'pdf',
      blobType: 'application/pdf',
    })
  })

  it('never gives a Blob a type that a browser opens as a document', () => {
    const types = [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/x-icon',
      'image/svg+xml',
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/flac',
      'application/pdf',
      'text/html',
      'text/plain',
      'application/json',
    ]
    for (const type of types) {
      const rendering = safeRendering({ type })
      if ('blobType' in rendering && rendering.renderer !== 'svg')
        expect(rendering.blobType).toMatch(
          /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon)|video\/|audio\/|application\/pdf$)/
        )
    }
    expect(DOWNLOAD_BLOB_TYPE).toBe('application/octet-stream')
  })

  it('has a size limit for every renderer that loads content', () => {
    for (const renderer of [
      'image',
      'svg',
      'video',
      'audio',
      'pdf',
      'text',
    ] as const)
      expect(INLINE_PREVIEW_MAX_BYTES[renderer]).toBeGreaterThan(0)
  })

  it('normalizes a claimed type and survives values that are not text', () => {
    expect(normalizedType(' Text/HTML ; charset=utf-8')).toBe('text/html')
    expect(normalizedType(undefined)).toBe('')
    expect(normalizedType({ toString: () => 'text/html' })).toBe('')
  })
})

describe('file name of decrypted content', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('Holiday photo (2).png')).toBe('Holiday photo (2).png')
    expect(safeFileName('résumé 日本語.pdf')).toBe('résumé 日本語.pdf')
  })

  it('keeps one path segment only', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\a\\b.txt')).toBe('b.txt')
    expect(safeFileName('a/b/')).toBe('file')
  })

  it('removes control characters and text-direction overrides', () => {
    expect(safeFileName('a\u0000b\nc\td.txt')).toBe('abcd.txt')
    // "photo" + RLO + "gnp.exe" would display as "photoexe.png".
    expect(safeFileName('photo\u202egnp.exe')).toBe('photognp.exe')
    expect(safeFileName('a\u2066b\u2069\u200f.txt')).toBe('ab.txt')
  })

  it('neutralizes names a file system treats specially', () => {
    expect(safeFileName('.htaccess')).toBe('htaccess')
    expect(safeFileName('...')).toBe('file')
    expect(safeFileName('name. . ')).toBe('name')
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('nul.txt')).toBe('_nul.txt')
    expect(safeFileName('a<b>:"c"|?*.txt')).toBe('a_b___c____.txt')
  })

  it('limits the length and replaces values that are not names', () => {
    expect(safeFileName('x'.repeat(5000))).toHaveLength(200)
    for (const value of ['', '   ', null, undefined, 7, {}, []])
      expect(safeFileName(value)).toBe('file')
  })
})

describe('sandboxed PDF preview', () => {
  it('is offered only where a sandboxed frame can show a PDF', () => {
    expect(
      canPreviewSandboxedPdf({
        pdfViewerEnabled: true,
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
      })
    ).toBe(true)
    expect(
      canPreviewSandboxedPdf({
        pdfViewerEnabled: true,
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      })
    ).toBe(false)
    expect(
      canPreviewSandboxedPdf({
        pdfViewerEnabled: true,
        userAgent: 'Something',
        brands: [{ brand: 'Chromium' }],
      })
    ).toBe(false)
    expect(
      canPreviewSandboxedPdf({ pdfViewerEnabled: false, userAgent: 'Firefox' })
    ).toBe(false)
    expect(canPreviewSandboxedPdf({})).toBe(false)
  })
})
