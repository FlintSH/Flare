import { describe, expect, it } from 'vitest'

import {
  cutUtf8,
  newEncryptedFile,
  openSealedOcrText,
  openSealedThumbnail,
  sealedOcrTextRecord,
  sealedThumbnailRecord,
} from '@/lib/e2ee/client/files'
import { createLruCache, isWebp } from '@/lib/e2ee/client/thumbnails'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import { thumbnailKind } from '@/lib/files/thumbnail-client'

import { clientKeys } from '../../auth/e2ee-test-keys'

const keys = clientKeys().accountKeys
const file = () =>
  newEncryptedFile({
    name: 'photo.png',
    type: 'image/png',
    accountPublicKey: keys.accountPublicKey,
  })

describe('sealed thumbnails and image text in the browser', () => {
  it('seals a thumbnail that only the key of its file opens', () => {
    const one = file()
    const other = file()
    const webp = Uint8Array.from([
      82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 1,
    ])
    const stored = base64urlDecode(sealedThumbnailRecord(one, webp))
    expect(stored[0]).toBe(1)
    expect(Buffer.from(stored).includes(Buffer.from('WEBP'))).toBe(false)
    expect(openSealedThumbnail(one, stored)).toEqual(webp)
    expect(() => openSealedThumbnail(other, stored)).toThrow()
    expect(() => sealedThumbnailRecord(one, new Uint8Array(250_001))).toThrow()
  })

  it('shows decrypted bytes only when they are a WebP image', () => {
    expect(isWebp(Uint8Array.from(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')))).toBe(
      true
    )
    expect(isWebp(Uint8Array.from(Buffer.from('<svg onload=alert(1)>')))).toBe(
      false
    )
    expect(isWebp(Uint8Array.from(Buffer.from('RIFF\0\0\0\0WAVEfmt ')))).toBe(
      false
    )
    expect(isWebp(new Uint8Array(4))).toBe(false)
  })

  it('makes thumbnails for images and videos, and not for an SVG document', () => {
    expect(thumbnailKind('image/png')).toBe('image')
    expect(thumbnailKind('IMAGE/JPEG')).toBe('image')
    expect(thumbnailKind('video/mp4')).toBe('video')
    expect(thumbnailKind('image/svg+xml')).toBeNull()
    expect(thumbnailKind('application/pdf')).toBeNull()
    expect(thumbnailKind('')).toBeNull()
  })

  it('keeps a bounded number of thumbnails and releases the least recently used', () => {
    const released: string[] = []
    const cache = createLruCache<string>(2, (value) => released.push(value))
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A')
    cache.set('c', 'C')
    expect(released).toEqual(['B'])
    expect(cache.get('b')).toBeUndefined()
    cache.set('a', 'A2')
    expect(released).toEqual(['B', 'A'])
    cache.delete('c')
    cache.clear()
    expect(released).toEqual(['B', 'A', 'C', 'A2'])
    expect(cache.size).toBe(0)
  })

  it('seals image text, and cuts text that is too long at a character', () => {
    const one = file()
    const sealed = sealedOcrTextRecord(one, 'Total due: 12 €')
    expect(sealed).not.toContain('Total')
    expect(openSealedOcrText(one, sealed)).toBe('Total due: 12 €')
    expect(openSealedOcrText(one, base64urlDecode(sealed))).toBe(
      'Total due: 12 €'
    )
    expect(() => openSealedOcrText(file(), sealed)).toThrow()
    // An empty text is a valid record: the image was read and has no text.
    expect(openSealedOcrText(one, sealedOcrTextRecord(one, ''))).toBe('')
    expect(cutUtf8('héllo', 2)).toBe('h')
    expect(cutUtf8('héllo', 3)).toBe('hé')
    expect(cutUtf8('😀😀', 5)).toBe('😀')
    expect(cutUtf8('short', 100)).toBe('short')
    const long = openSealedOcrText(
      one,
      sealedOcrTextRecord(one, 'é'.repeat(200_000))
    )
    expect(new TextEncoder().encode(long).length).toBe(250_000)
  })
})
