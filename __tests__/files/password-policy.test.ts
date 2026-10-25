import { PATCH } from '@/app/api/files/[id]/route'
import { PATCH as moderatePATCH } from '@/app/api/users/[id]/files/[fileId]/route'
import { describe, expect, it, vi } from 'vitest'

import {
  FILE_PASSWORD_MAX_BYTES,
  FILE_PASSWORD_MIN_LENGTH,
  filePasswordHint,
  newFilePasswordSchema,
} from '@/lib/files/password-policy'
import { parseUploadFields, uploadErrorResponse } from '@/lib/uploads/options'
import { uploadRequestOptionsSchema } from '@/lib/uploads/schema'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: vi.fn(), update: mocks.update } },
}))
vi.mock('@/lib/permissions/server', () => ({
  requirePermission: async () => ({
    session: { user: { id: 'moderator' } },
    response: null,
  }),
}))
vi.mock('@/lib/security/request-origin', () => ({
  isSameOriginRequest: () => true,
}))

describe('new file password rules', () => {
  it('requires 8 characters and at most 72 UTF-8 bytes', () => {
    expect(FILE_PASSWORD_MIN_LENGTH).toBe(8)
    expect(FILE_PASSWORD_MAX_BYTES).toBe(72)
    expect(newFilePasswordSchema.safeParse('1234567').success).toBe(false)
    expect(newFilePasswordSchema.safeParse('12345678').success).toBe(true)
    expect(newFilePasswordSchema.safeParse('a'.repeat(72)).success).toBe(true)
    expect(newFilePasswordSchema.safeParse('a'.repeat(73)).success).toBe(false)
    // 18 four-byte characters are exactly 72 bytes; one more is too long.
    expect(newFilePasswordSchema.safeParse('🔒'.repeat(18)).success).toBe(true)
    expect(newFilePasswordSchema.safeParse('🔒'.repeat(19)).success).toBe(false)
    // Empty keeps its meaning: no password, or remove the current one.
    expect(newFilePasswordSchema.safeParse('').success).toBe(true)
  })

  it('gives forms a hint only for values that break a rule', () => {
    expect(filePasswordHint('abc')).toBe('Use at least 8 characters.')
    expect(filePasswordHint('🔒'.repeat(19))).toContain('at most 72 bytes')
    expect(filePasswordHint('long-enough')).toBeNull()
  })

  it('rejects short upload passwords with a specific message', async () => {
    expect(() => uploadRequestOptionsSchema.parse({ password: 'abc' })).toThrow(
      'File passwords must be at least 8 characters.'
    )
    expect(uploadRequestOptionsSchema.parse({ password: '' })).toEqual({
      password: '',
    })

    let failure: unknown
    try {
      parseUploadFields({ password: 'abc' })
    } catch (error) {
      failure = error
    }
    const response = uploadErrorResponse(failure)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File passwords must be at least 8 characters.',
    })
  })

  it('rejects short passwords when protecting an existing file', async () => {
    const response = await PATCH(
      new Request('https://flare.test/api/files/file-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'abc' }),
      }),
      { params: Promise.resolve({ id: 'file-1' }) }
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File passwords must be at least 8 characters.',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('applies the same rule to moderators setting a password', async () => {
    const response = await moderatePATCH(
      new Request('https://flare.test/api/users/user-1/files/file-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'a'.repeat(73) }),
      }),
      { params: Promise.resolve({ id: 'user-1', fileId: 'file-1' }) }
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File passwords must be at most 72 bytes.',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
