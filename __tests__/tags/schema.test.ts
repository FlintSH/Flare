import { describe, expect, it } from 'vitest'

import {
  TAG_NAME_MAX_LENGTH,
  TAG_RULE_MAX_LENGTH,
  fileTagsInputSchema,
  matchesTagRule,
  tagInputSchema,
  tagNameSchema,
} from '@/lib/tags/schema'

describe('tag names and automatic rules', () => {
  it('enforces the limits the forms use, with the same messages', () => {
    expect(tagNameSchema.parse('x'.repeat(TAG_NAME_MAX_LENGTH))).toHaveLength(
      TAG_NAME_MAX_LENGTH
    )
    expect(
      tagNameSchema.safeParse('x'.repeat(TAG_NAME_MAX_LENGTH + 1)).error
        ?.issues[0].message
    ).toBe('Tag names can be up to 40 characters.')
    expect(tagNameSchema.safeParse(' ').error?.issues[0].message).toBe(
      'Give your tag a name.'
    )
    expect(tagNameSchema.safeParse('a\u200bb').error?.issues[0].message).toBe(
      'Use a plain-text name.'
    )
    const rule = { name: 'Work', ruleSource: 'filename' }
    expect(
      tagInputSchema.safeParse({
        ...rule,
        ruleText: 'x'.repeat(TAG_RULE_MAX_LENGTH),
      }).success
    ).toBe(true)
    expect(
      tagInputSchema.safeParse({
        ...rule,
        ruleText: 'x'.repeat(TAG_RULE_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
  })

  it('turns a typed tab or line break into a space, unlike folder names', () => {
    expect(tagNameSchema.parse('Work\tnotes\n')).toBe('Work notes')
  })

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
