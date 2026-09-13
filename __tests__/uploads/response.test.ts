import { describe, expect, it } from 'vitest'

import { parseUploadResponse } from '@/lib/uploads/response'

const response = {
  url: 'https://files.example/alice/note.txt',
  name: 'note.txt',
  size: 25,
  type: 'text/plain',
}

describe('upload completion responses', () => {
  it('accepts both wrapped API responses and legacy raw responses', () => {
    expect(parseUploadResponse({ data: response })).toEqual(response)
    expect(parseUploadResponse({ ...response, id: 'legacy-file' })).toEqual(
      response
    )
  })

  it('preserves zero-byte files, separate open URLs, and formatted copy text', () => {
    const withLinks = {
      ...response,
      size: 0,
      url: 'https://files.example/api/files/alice/note.txt',
      pageUrl: response.url,
      copyText: `[note](${response.url})`,
    }
    expect(parseUploadResponse({ data: withLinks })).toEqual(withLinks)
  })

  it.each([null, undefined, [], 'uploaded', {}, { data: {} }, { data: null }])(
    'rejects a malformed successful body instead of completing the queue: %j',
    (value) => {
      expect(() => parseUploadResponse(value)).toThrow(
        'Could not read the upload response.'
      )
    }
  )

  it.each(['name', 'url', 'size', 'type'] as const)(
    'requires the %s field in direct and multipart completion responses',
    (field) => {
      const incomplete: Record<string, unknown> = { ...response }
      delete incomplete[field]
      expect(() => parseUploadResponse(incomplete)).toThrow()
      expect(() => parseUploadResponse({ data: incomplete })).toThrow()
    }
  )

  it.each([
    { name: 7 },
    { name: '' },
    { url: '' },
    { url: 'not-a-link' },
    { url: 'javascript:alert(1)' },
    { size: '25' },
    { size: -1 },
    { size: 1.5 },
    { size: Infinity },
    { size: NaN },
    { type: null },
    { type: '' },
    { pageUrl: null },
    { pageUrl: '/relative-path' },
    { copyText: { url: response.url } },
  ])('rejects invalid fields: %j', (invalid) => {
    expect(() =>
      parseUploadResponse({ data: { ...response, ...invalid } })
    ).toThrow()
  })

  it('does not use outer fields to hide an invalid data envelope', () => {
    expect(() => parseUploadResponse({ ...response, data: false })).toThrow()
  })
})
