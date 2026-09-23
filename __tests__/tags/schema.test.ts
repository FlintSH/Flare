import { describe, expect, it } from 'vitest'

import {
  fileTagsInputSchema,
  matchesTagRule,
  tagInputSchema,
} from '@/lib/tags/schema'

describe('tag names and automatic rules', () => {
  it('normalizes equivalent names and whitespace before enforcing the name limit', () => {
    expect(tagInputSchema.parse({ name: '  Ｗork   notes  ' })).toEqual({
      name: 'Work notes',
      ruleSource: null,
      ruleText: null,
    })
    expect(tagInputSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(
      false
    )
    expect(tagInputSchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(tagInputSchema.safeParse({ name: 'hidden\u200btext' }).success).toBe(
      false
    )
  })

  it.each([
    { name: 'Work', ruleSource: 'ocr' },
    { name: 'Work', ruleSource: 'filename', ruleText: '  ' },
    { name: 'Work', ruleText: 'receipt' },
    { name: 'Work', ruleSource: 'filename', ruleText: 'x'.repeat(201) },
    { name: 'Work', ruleSource: 'regex', ruleText: '.*' },
  ])('rejects incomplete or unsupported rules %j', (input) => {
    expect(tagInputSchema.safeParse(input).success).toBe(false)
  })

  it('treats matching as a case-insensitive literal substring', () => {
    expect(matchesTagRule('Invoice from ACME.png', 'acme')).toBe(true)
    expect(matchesTagRule('Saved 20%_sale.png', '20%_')).toBe(true)
    expect(matchesTagRule('Saved 2000_sale.png', '20%_')).toBe(false)
    expect(matchesTagRule('report.pdf', '.*')).toBe(false)
    expect(matchesTagRule(null, 'invoice')).toBe(false)
    expect(matchesTagRule('report.pdf', '')).toBe(false)
  })

  it('bounds bulk changes and rejects supplied ownership', () => {
    expect(
      fileTagsInputSchema.safeParse({
        fileIds: Array.from({ length: 101 }, (_, i) => `${i}`),
        tagId: 'tag',
        action: 'add',
      }).success
    ).toBe(false)
    expect(
      tagInputSchema.safeParse({ name: 'Work', userId: 'someone-else' }).success
    ).toBe(false)
  })
})
