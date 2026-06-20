import { describe, expect, it } from 'vitest'

import {
  mimeTypesMatch,
  validateFileType,
} from '@/lib/security/file-validation'

// Minimal byte fixtures with valid magic numbers for each format.
// 1x1 PNG: signature + IHDR chunk (file-type peeks past the signature).
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
])
// ZIP local file header signature (PK\x03\x04).
const ZIP = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
])
// PE/exe ("MZ").
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])

describe('mimeTypesMatch', () => {
  it('matches identical types', () => {
    expect(mimeTypesMatch('image/png', 'image/png')).toBe(true)
  })

  it('accepts Windows zip spelling vs detected zip (#174)', () => {
    expect(
      mimeTypesMatch('application/zip', 'application/x-zip-compressed')
    ).toBe(true)
    // bidirectional
    expect(
      mimeTypesMatch('application/x-zip-compressed', 'application/zip')
    ).toBe(true)
  })

  it('accepts zip-container office documents detected as zip', () => {
    expect(
      mimeTypesMatch(
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe(true)
    expect(
      mimeTypesMatch(
        'application/zip',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    ).toBe(true)
  })

  it('accepts common audio/image aliases', () => {
    expect(mimeTypesMatch('audio/mpeg', 'audio/mp3')).toBe(true)
    expect(mimeTypesMatch('image/jpeg', 'image/jpg')).toBe(true)
  })

  it('accepts cross-prefix video/audio for the mp4 family', () => {
    expect(mimeTypesMatch('video/mp4', 'audio/mp4')).toBe(true)
    expect(mimeTypesMatch('video/quicktime', 'video/mp4')).toBe(true)
  })

  it('accepts any video/* vs video/* and audio/* vs audio/*', () => {
    expect(mimeTypesMatch('video/webm', 'video/x-matroska')).toBe(true)
    expect(mimeTypesMatch('audio/ogg', 'audio/x-vorbis')).toBe(true)
  })

  it('rejects genuinely different types', () => {
    expect(mimeTypesMatch('application/x-msdownload', 'image/png')).toBe(false)
    expect(mimeTypesMatch('application/zip', 'image/png')).toBe(false)
  })
})

describe('validateFileType', () => {
  it('accepts a real png claimed as png', async () => {
    expect(await validateFileType(PNG, 'image/png')).toEqual({
      valid: true,
      detectedType: 'image/png',
    })
  })

  it('accepts a real jpeg claimed as image/jpg', async () => {
    const result = await validateFileType(JPEG, 'image/jpg')
    expect(result.valid).toBe(true)
    expect(result.detectedType).toBe('image/jpeg')
  })

  it('accepts a real gif claimed as image/gif', async () => {
    const result = await validateFileType(GIF, 'image/gif')
    expect(result).toEqual({ valid: true, detectedType: 'image/gif' })
  })

  it('accepts a Windows zip (claimed x-zip-compressed) (#174)', async () => {
    const result = await validateFileType(ZIP, 'application/x-zip-compressed')
    expect(result.valid).toBe(true)
    expect(result.detectedType).toBe('application/zip')
  })

  it('accepts a docx (zip container) claimed as officedocument', async () => {
    const result = await validateFileType(
      ZIP,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(result.valid).toBe(true)
  })

  it('rejects a spoofed file (exe claimed as png)', async () => {
    const result = await validateFileType(EXE, 'image/png')
    expect(result.valid).toBe(false)
    expect(result.detectedType).toBe('application/x-msdownload')
  })

  it('passes through undetectable/text content as valid', async () => {
    const text = Buffer.from('just some plain text, nothing magic here')
    const result = await validateFileType(text, 'text/plain')
    expect(result).toEqual({ valid: true, detectedType: null })
  })
})
