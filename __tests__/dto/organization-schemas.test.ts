import { describe, expect, it } from 'vitest'

import {
  BulkFileActionSchema,
  UpdateFileSchema,
} from '@/types/dto/file'
import { CreateFolderSchema, UpdateFolderSchema } from '@/types/dto/folder'
import { CreateTagSchema } from '@/types/dto/tag'

describe('CreateFolderSchema', () => {
  it('accepts a valid folder', () => {
    const result = CreateFolderSchema.safeParse({ name: 'Screenshots' })
    expect(result.success).toBe(true)
  })

  it('trims the name', () => {
    const result = CreateFolderSchema.parse({ name: '  Photos  ' })
    expect(result.name).toBe('Photos')
  })

  it('rejects an empty name', () => {
    expect(CreateFolderSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects an unknown color', () => {
    expect(
      CreateFolderSchema.safeParse({ name: 'X', color: 'chartreuse' }).success
    ).toBe(false)
  })
})

describe('UpdateFolderSchema', () => {
  it('requires at least one field', () => {
    expect(UpdateFolderSchema.safeParse({}).success).toBe(false)
  })

  it('allows moving to root via null parentId', () => {
    expect(UpdateFolderSchema.safeParse({ parentId: null }).success).toBe(true)
  })
})

describe('CreateTagSchema', () => {
  it('accepts a valid tag', () => {
    expect(CreateTagSchema.safeParse({ name: 'important' }).success).toBe(true)
  })

  it('rejects empty tag names', () => {
    expect(CreateTagSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('BulkFileActionSchema', () => {
  const ids = ['ckvalidcuid000000000000001']

  it('accepts a move action', () => {
    const result = BulkFileActionSchema.safeParse({
      fileIds: ids,
      action: 'move',
      folderId: null,
    })
    expect(result.success).toBe(true)
  })

  it('requires tagIds for addTags', () => {
    const result = BulkFileActionSchema.safeParse({
      fileIds: ids,
      action: 'addTags',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty fileIds list', () => {
    const result = BulkFileActionSchema.safeParse({
      fileIds: [],
      action: 'delete',
    })
    expect(result.success).toBe(false)
  })
})

describe('UpdateFileSchema', () => {
  it('requires at least one field', () => {
    expect(UpdateFileSchema.safeParse({}).success).toBe(false)
  })

  it('accepts folderId null (remove from folder)', () => {
    expect(UpdateFileSchema.safeParse({ folderId: null }).success).toBe(true)
  })

  it('accepts a tag replacement', () => {
    expect(
      UpdateFileSchema.safeParse({ tagIds: ['ckvalidcuid000000000000001'] })
        .success
    ).toBe(true)
  })
})
