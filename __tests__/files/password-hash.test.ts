import { compare } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { hashFilePassword } from '@/lib/files/password-hash'

describe('stored file passwords', () => {
  it('stores a bcrypt hash at cost 10 that verifies the password', async () => {
    const stored = await hashFilePassword('correct horse battery')
    expect(stored).toMatch(/^\$2[ab]\$10\$/)
    expect(await compare('correct horse battery', stored!)).toBe(true)
  })

  it.each(['', null, undefined])('stores no password for %j', async (value) => {
    expect(await hashFilePassword(value)).toBeNull()
  })
})
