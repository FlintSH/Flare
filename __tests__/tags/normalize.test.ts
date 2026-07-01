import { TAG_NAME_MAX_LENGTH } from '@/types/dto/tag'
import { describe, expect, it } from 'vitest'

import { normalizeTagName, tagNamesEqual } from '@/lib/tags/normalize'

describe('normalizeTagName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTagName('  design  ')).toBe('design')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeTagName('work   in     progress')).toBe('work in progress')
  })

  it('preserves casing', () => {
    expect(normalizeTagName('ProjectX')).toBe('ProjectX')
  })

  it('clamps to the maximum length', () => {
    const long = 'a'.repeat(TAG_NAME_MAX_LENGTH + 10)
    expect(normalizeTagName(long).length).toBe(TAG_NAME_MAX_LENGTH)
  })
})

describe('tagNamesEqual', () => {
  it('is case-insensitive', () => {
    expect(tagNamesEqual('Design', 'design')).toBe(true)
  })

  it('distinguishes different names', () => {
    expect(tagNamesEqual('design', 'designs')).toBe(false)
  })
})
