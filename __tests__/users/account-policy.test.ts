import { UpdateProfileSchema } from '@/types/dto/profile'
import { UserSchema } from '@/types/dto/user'
import { describe, expect, it } from 'vitest'

import { newFilePasswordSchema } from '@/lib/files/password-policy'
import { setupAdminSchema } from '@/lib/setup/schema'
import {
  accountNameSchema,
  accountPasswordSchema,
  fitsPasswordHash,
} from '@/lib/users/account-policy'
import { isUrlIdDraft, urlIdSchema } from '@/lib/users/public-id'

const admin = {
  name: 'admin',
  email: 'admin@example.test',
  password: 'long-enough-password',
}

function firstError(result: {
  success: boolean
  error?: { issues: { message: string }[] }
}) {
  return result.success ? null : result.error!.issues[0].message
}

describe('account names', () => {
  it('accept any name an earlier version saved, and refuse only an empty one', () => {
    // Setup saved one-character names; registration and Users saved
    // untrimmed names of two characters, spaces included.
    for (const name of ['a', 'Al', '  ', ' Bob '])
      expect(accountNameSchema.safeParse(name).success).toBe(true)
    expect(firstError(accountNameSchema.safeParse(''))).toBe(
      'Username is required'
    )
  })

  it('let a later edit keep the name setup gave the first administrator', () => {
    const { name } = setupAdminSchema.parse({ ...admin, name: ' A ' })
    expect(name).toBe('A')
    expect(UserSchema.partial().safeParse({ id: 'admin', name }).success).toBe(
      true
    )
    expect(UpdateProfileSchema.safeParse({ name }).success).toBe(true)
  })

  it('keep setup trimming the name it saves', () => {
    expect(
      firstError(setupAdminSchema.safeParse({ ...admin, name: '  ' }))
    ).toBe('Username is required')
  })
})

describe('account passwords', () => {
  it.each([
    [
      'UserSchema',
      (password: string) => UserSchema.safeParse({ ...admin, password }),
    ],
    [
      'UpdateProfileSchema',
      (password: string) =>
        UpdateProfileSchema.safeParse({ newPassword: password }),
    ],
    [
      'setup',
      (password: string) => setupAdminSchema.safeParse({ ...admin, password }),
    ],
    [
      'the shared rule',
      (password: string) => accountPasswordSchema.safeParse(password),
    ],
  ])('need 8 characters and at most 72 bytes in %s', (_, parse) => {
    expect(parse('1234567').success).toBe(false)
    expect(parse('12345678').success).toBe(true)
    expect(parse('a'.repeat(72)).success).toBe(true)
    // 18 four-byte characters are exactly 72 bytes; one more is too long.
    expect(parse('🔒'.repeat(18)).success).toBe(true)
    for (const password of ['a'.repeat(73), '🔒'.repeat(19)])
      expect(firstError(parse(password))).toBe(
        'Password must use at most 72 bytes.'
      )
  })

  it('keep the wording each form already showed for a short password', () => {
    expect(
      firstError(setupAdminSchema.safeParse({ ...admin, password: 'short' }))
    ).toBe('Password must be at least 8 characters')
    expect(firstError(accountPasswordSchema.safeParse('short'))).toBe(
      'Too small: expected string to have >=8 characters'
    )
  })

  it('share the byte limit with file passwords', () => {
    expect(fitsPasswordHash('🔒'.repeat(18))).toBe(true)
    expect(fitsPasswordHash('🔒'.repeat(19))).toBe(false)
    expect(newFilePasswordSchema.safeParse('🔒'.repeat(19)).success).toBe(false)
  })
})

describe('URL IDs', () => {
  it('keep letter case, since file URLs use the ID as written', () => {
    expect(urlIdSchema.parse('aB3x9')).toBe('aB3x9')
    expect(UserSchema.partial().parse({ urlId: 'aB3x9' }).urlId).toBe('aB3x9')
    for (const urlId of ['aB3x', 'aB3x9z', 'aB-x9', ''])
      expect(firstError(urlIdSchema.safeParse(urlId))).toBe(
        'URL ID must be 5 alphanumeric characters'
      )
  })

  it('let the form accept an ID while it is typed, case included', () => {
    for (const draft of ['', 'a', 'aB3', 'aB3x9'])
      expect(isUrlIdDraft(draft)).toBe(true)
    for (const draft of ['aB-', 'aB3x9z', 'é'])
      expect(isUrlIdDraft(draft)).toBe(false)
  })
})
