import { describe, expect, it } from 'vitest'

import {
  FOLDER_NAME_MAX_LENGTH,
  fileFoldersInputSchema,
  folderInputSchema,
  folderNameSchema,
  folderUpdateSchema,
} from '@/lib/folders/schema'
import { nameKey, normalizeName } from '@/lib/library/names'
import { tagNameSchema } from '@/lib/tags/schema'

describe('folder and tag names', () => {
  it('store one normalized form and compare without case', () => {
    expect(normalizeName('  Ｗeek \u3000 1\t')).toBe('Week 1')
    expect(nameKey('Week 1')).toBe('week 1')
    // The tag dialog finds an existing tag by this key before creating one.
    expect(nameKey(normalizeName(' work  NOTES'))).toBe(
      nameKey(tagNameSchema.parse('Work notes'))
    )
    expect(folderNameSchema.parse('  Ｗork   notes ')).toBe(
      tagNameSchema.parse('  Ｗork   notes ')
    )
  })

  it('enforces the folder limit the forms use, with the same messages', () => {
    expect(
      folderNameSchema.parse('x'.repeat(FOLDER_NAME_MAX_LENGTH))
    ).toHaveLength(FOLDER_NAME_MAX_LENGTH)
    expect(
      folderNameSchema.safeParse('x'.repeat(FOLDER_NAME_MAX_LENGTH + 1)).error
        ?.issues[0].message
    ).toBe('Folder names can be up to 80 characters.')
    expect(folderNameSchema.safeParse(' ').error?.issues[0].message).toBe(
      'Give your folder a name.'
    )
    expect(folderNameSchema.safeParse('Work\tnotes').error?.issues).toEqual([
      expect.objectContaining({ message: 'Use a plain-text name.' }),
    ])
    expect(folderNameSchema.safeParse(' .. ').error?.issues[0].message).toBe(
      'Choose a name without slashes; "." and ".." are reserved.'
    )
  })
})

describe('folder input', () => {
  it('normalizes names while keeping nesting separate from names', () => {
    expect(folderInputSchema.parse({ name: '  Ｗeek   1 ' })).toEqual({
      name: 'Week 1',
      parentId: null,
    })
    expect(
      folderInputSchema.parse({ name: 'Week 1', parentId: 'photos' })
    ).toEqual({ name: 'Week 1', parentId: 'photos' })
  })

  it.each([
    '',
    '   ',
    '.',
    '..',
    'Photos/Week 1',
    'Photos\\Week 1',
    'A\u200bB',
    'A\nB',
    'x'.repeat(81),
  ])('rejects confusing names %j', (name) =>
    expect(folderNameSchema.safeParse(name).success).toBe(false)
  )

  it('accepts only explicit rename or sharing changes, never arbitrary tokens or hierarchy rewrites', () => {
    expect(folderUpdateSchema.parse({ sharing: false })).toEqual({
      sharing: false,
    })
    for (const input of [
      {},
      { shareToken: 'guessable' },
      { parentId: 'child' },
      { name: 'Work', userId: 'other' },
    ]) {
      expect(folderUpdateSchema.safeParse(input).success).toBe(false)
    }
  })

  it('requires a deliberate destination, permits unfiling, and bounds bulk requests', () => {
    expect(
      fileFoldersInputSchema.parse({ fileIds: ['file'], folderId: null })
    ).toEqual({
      fileIds: ['file'],
      folderId: null,
    })
    for (const input of [
      { fileIds: ['file'] },
      { fileIds: [], folderId: 'folder' },
      { fileIds: Array(101).fill('file'), folderId: 'folder' },
      { fileIds: ['file'], folderId: '' },
    ])
      expect(fileFoldersInputSchema.safeParse(input).success).toBe(false)
  })
})
