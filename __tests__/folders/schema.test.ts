import { describe, expect, it } from 'vitest'

import {
  fileFoldersInputSchema,
  folderInputSchema,
  folderNameSchema,
  folderUpdateSchema,
} from '@/lib/folders/schema'

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
