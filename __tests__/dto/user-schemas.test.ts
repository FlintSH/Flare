import { VanityIdSchema } from '@/types/dto/user'
import { UserSchema } from '@/types/dto/user'
import { UpdateProfileSchema } from '@/types/dto/profile'
import { describe, expect, it } from 'vitest'

describe('VanityIdSchema', () => {
  it('accepts a valid vanity ID', () => {
    const result = VanityIdSchema.safeParse('my-name')
    expect(result.success).toBe(true)
  })

  it('rejects empty string', () => {
    const result = VanityIdSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('rejects string shorter than 3 characters', () => {
    const result = VanityIdSchema.safeParse('ab')
    expect(result.success).toBe(false)
  })

  it('rejects reserved paths', () => {
    const result = VanityIdSchema.safeParse('dashboard')
    expect(result.success).toBe(false)
  })
})

describe('UserSchema – vanityId optional behavior', () => {
  const validBase = {
    name: 'Test User',
    email: 'test@example.com',
    role: 'USER' as const,
  }

  it('accepts vanityId as null', () => {
    const result = UserSchema.safeParse({ ...validBase, vanityId: null })
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBeNull()
  })

  it('accepts vanityId as undefined (omitted)', () => {
    const result = UserSchema.safeParse(validBase)
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBeUndefined()
  })

  it('accepts a valid vanityId string', () => {
    const result = UserSchema.safeParse({
      ...validBase,
      vanityId: 'my-custom-url',
    })
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBe('my-custom-url')
  })

  it('rejects empty string vanityId (must be normalized to null before parsing)', () => {
    const result = UserSchema.safeParse({ ...validBase, vanityId: '' })
    expect(result.success).toBe(false)
  })
})

describe('UpdateProfileSchema – vanityId optional behavior', () => {
  it('accepts vanityId as null', () => {
    const result = UpdateProfileSchema.safeParse({ vanityId: null })
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBeNull()
  })

  it('accepts vanityId omitted', () => {
    const result = UpdateProfileSchema.safeParse({ name: 'Foo' })
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBeUndefined()
  })

  it('rejects empty string (must be normalized to null before parsing)', () => {
    const result = UpdateProfileSchema.safeParse({ vanityId: '' })
    expect(result.success).toBe(false)
  })
})

describe('vanityId normalization helper', () => {
  function normalizeVanityId(
    raw: unknown
  ): string | null | undefined {
    if (raw === undefined) return undefined
    if (typeof raw === 'string' && raw.trim() === '') return null
    if (raw === null) return null
    return raw as string
  }

  it('converts empty string to null', () => {
    expect(normalizeVanityId('')).toBeNull()
  })

  it('converts whitespace-only string to null', () => {
    expect(normalizeVanityId('  ')).toBeNull()
  })

  it('preserves undefined', () => {
    expect(normalizeVanityId(undefined)).toBeUndefined()
  })

  it('preserves null', () => {
    expect(normalizeVanityId(null)).toBeNull()
  })

  it('preserves a valid string', () => {
    expect(normalizeVanityId('my-vanity')).toBe('my-vanity')
  })

  it('normalized empty string passes UserSchema after conversion', () => {
    const raw = { name: 'Test', email: 'a@b.com', role: 'USER', vanityId: '' }
    const normalized = { ...raw, vanityId: normalizeVanityId(raw.vanityId) }
    const result = UserSchema.safeParse(normalized)
    expect(result.success).toBe(true)
    expect(result.data?.vanityId).toBeNull()
  })
})
