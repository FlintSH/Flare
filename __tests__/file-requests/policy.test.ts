import { describe, expect, it } from 'vitest'

import {
  FILE_REQUEST_TOKEN_PATTERN,
  MAX_PARTS,
  MIN_PART_BYTES,
  fileRequestCreateSchema,
  fileRequestStatus,
  fileRequestUpdateSchema,
  fileRequestUrl,
  formatRequestBytes,
  requestPartSize,
  submissionCreateSchema,
} from '@/lib/file-requests/policy'
import {
  createFileRequestToken,
  createSubmissionKey,
  hashSubmissionKey,
  isFileRequestToken,
  isSubmissionKey,
} from '@/lib/file-requests/tokens'

const open = {
  closedAt: null,
  expiresAt: null,
  maxFiles: null,
  fileCount: 0,
  maxBytes: null,
  bytesReceived: 0,
}

describe('file request status', () => {
  const now = new Date('2026-11-03T12:00:00Z')

  it('is open until the owner closes it, it expires, or a limit is reached', () => {
    expect(fileRequestStatus(open, now)).toBe('open')
    expect(
      fileRequestStatus({ ...open, expiresAt: '2026-11-03T12:00:01Z' }, now)
    ).toBe('open')
    expect(fileRequestStatus({ ...open, expiresAt: now }, now)).toBe('expired')
    expect(fileRequestStatus({ ...open, maxFiles: 2, fileCount: 2 }, now)).toBe(
      'full'
    )
    expect(
      fileRequestStatus(
        { ...open, maxBytes: BigInt(10), bytesReceived: BigInt(10) },
        now
      )
    ).toBe('full')
    expect(
      fileRequestStatus(
        { ...open, maxBytes: BigInt(10), bytesReceived: BigInt(9) },
        now
      )
    ).toBe('open')
  })

  it('reports an owner closure before expiry or limits', () => {
    expect(
      fileRequestStatus(
        {
          ...open,
          closedAt: now,
          expiresAt: '2020-01-01T00:00:00Z',
          maxFiles: 1,
          fileCount: 1,
        },
        now
      )
    ).toBe('closed')
    expect(
      fileRequestStatus(
        {
          ...open,
          expiresAt: '2020-01-01T00:00:00Z',
          maxFiles: 1,
          fileCount: 1,
        },
        now
      )
    ).toBe('expired')
  })
})

describe('file request input', () => {
  it('applies defaults: optional sender name, account default upload settings, and a week', () => {
    expect(
      fileRequestCreateSchema.parse({ title: '  Tax documents  ' })
    ).toEqual({
      title: 'Tax documents',
      message: '',
      senderName: 'optional',
      profileId: null,
      folderId: null,
      maxFiles: null,
      maxBytes: null,
      expiresInHours: 168,
      notify: false,
    })
  })

  it.each([
    { title: '' },
    { title: 'Two\nlines' },
    { title: 'a'.repeat(101) },
    { title: 'Ok', message: 'a'.repeat(1001) },
    { title: 'Ok', message: 'bell\u0007' },
    { title: 'Ok', maxFiles: 0 },
    { title: 'Ok', maxFiles: 1.5 },
    { title: 'Ok', maxBytes: 1024 },
    { title: 'Ok', expiresInHours: 0 },
    { title: 'Ok', senderName: 'sometimes' },
    { title: 'Ok', visibility: 'PUBLIC' },
  ])('rejects %j', (input) => {
    expect(fileRequestCreateSchema.safeParse(input).success).toBe(false)
  })

  it('keeps line breaks in messages for senders', () => {
    expect(
      fileRequestCreateSchema.parse({
        title: 'Photos',
        message: 'Line one\nLine two',
      }).message
    ).toBe('Line one\nLine two')
  })

  it('updates only what is sent and refuses an empty change', () => {
    expect(fileRequestUpdateSchema.parse({ closed: true })).toEqual({
      closed: true,
    })
    expect(fileRequestUpdateSchema.parse({ expiresInHours: null })).toEqual({
      expiresInHours: null,
    })
    expect(fileRequestUpdateSchema.safeParse({}).success).toBe(false)
    expect(
      fileRequestUpdateSchema.safeParse({ replaceLink: false }).success
    ).toBe(false)
  })

  it('bounds what senders type', () => {
    expect(submissionCreateSchema.parse({})).toEqual({
      senderName: '',
      note: '',
    })
    expect(
      submissionCreateSchema.safeParse({ senderName: 'a'.repeat(81) }).success
    ).toBe(false)
    expect(
      submissionCreateSchema.safeParse({ senderName: 'Sam\nLee' }).success
    ).toBe(false)
    expect(
      submissionCreateSchema.safeParse({ note: 'a'.repeat(501) }).success
    ).toBe(false)
  })
})

describe('file request links and parts', () => {
  it('issues 24-character links and 43-character submission keys', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => createFileRequestToken())
    )
    expect(tokens.size).toBe(200)
    for (const token of tokens) {
      expect(token).toMatch(FILE_REQUEST_TOKEN_PATTERN)
      expect(isFileRequestToken(token)).toBe(true)
    }
    expect(isFileRequestToken('short')).toBe(false)
    expect(isFileRequestToken(`${'a'.repeat(23)}/`)).toBe(false)
    const { key, hash } = createSubmissionKey()
    expect(isSubmissionKey(key)).toBe(true)
    expect(hashSubmissionKey(key)).toBe(hash)
    expect(hash).not.toContain(key)
  })

  it('builds links that work under any origin', () => {
    expect(fileRequestUrl('https://files.example/', 'abc-DEF_123')).toBe(
      'https://files.example/r/abc-DEF_123'
    )
  })

  it('uses 5 MiB parts and grows them only past 10,000 parts', () => {
    expect(requestPartSize(1)).toBe(MIN_PART_BYTES)
    expect(requestPartSize(MIN_PART_BYTES * MAX_PARTS)).toBe(MIN_PART_BYTES)
    const huge = MIN_PART_BYTES * MAX_PARTS + 1
    expect(requestPartSize(huge)).toBeGreaterThan(MIN_PART_BYTES)
    expect(Math.ceil(huge / requestPartSize(huge))).toBeLessThanOrEqual(
      MAX_PARTS
    )
  })

  it('formats sizes compactly', () => {
    expect(formatRequestBytes(0)).toBe('0 B')
    expect(formatRequestBytes(2009)).toBe('2 KB')
    expect(formatRequestBytes(12 * 1024 * 1024)).toBe('12 MB')
    expect(formatRequestBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
  })
})
