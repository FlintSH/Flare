import { describe, expect, it } from 'vitest'

import { buildFileOrderBy, buildFileWhere } from '@/lib/files/query'

describe('buildFileWhere', () => {
  it('scopes to the user with no conditions when no filters given', () => {
    const where = buildFileWhere('user-1', {})
    expect(where).toEqual({ userId: 'user-1' })
  })

  it('adds a case-insensitive search across name and ocrText', () => {
    const where = buildFileWhere('user-1', { search: 'cat' })
    expect(where.AND).toEqual([
      {
        OR: [
          { name: { contains: 'cat', mode: 'insensitive' } },
          { ocrText: { contains: 'cat', mode: 'insensitive' } },
        ],
      },
    ])
  })

  it('ignores blank/whitespace-only search', () => {
    const where = buildFileWhere('user-1', { search: '   ' })
    expect(where.AND).toBeUndefined()
  })

  it('filters by mime types', () => {
    const where = buildFileWhere('user-1', {
      types: ['image/png', 'image/gif'],
    })
    expect(where.AND).toContainEqual({
      mimeType: { in: ['image/png', 'image/gif'] },
    })
  })

  it('builds an inclusive end-of-day date range', () => {
    const where = buildFileWhere('user-1', {
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    })
    const dateCond = (where.AND as Record<string, unknown>[]).find(
      (c) => 'uploadedAt' in c
    ) as { uploadedAt: { gte: Date; lte: Date } }
    expect(dateCond.uploadedAt.gte).toEqual(new Date('2024-01-01'))
    expect(dateCond.uploadedAt.lte.getHours()).toBe(23)
    expect(dateCond.uploadedAt.lte.getMinutes()).toBe(59)
  })

  it('maps visibility filters including hasPassword', () => {
    const where = buildFileWhere('user-1', {
      visibility: ['public', 'private', 'hasPassword'],
    })
    expect(where.AND).toContainEqual({
      OR: [
        { visibility: 'PUBLIC' },
        { visibility: 'PRIVATE' },
        { password: { not: null } },
      ],
    })
  })

  it('ignores unknown visibility tokens', () => {
    const where = buildFileWhere('user-1', { visibility: ['bogus'] })
    expect(where.AND).toBeUndefined()
  })

  it('filters unfiled files when folderId is "none"', () => {
    const where = buildFileWhere('user-1', { folderId: 'none' })
    expect(where.AND).toContainEqual({ folderId: null })
  })

  it('filters by a specific folder id', () => {
    const where = buildFileWhere('user-1', { folderId: 'folder-1' })
    expect(where.AND).toContainEqual({ folderId: 'folder-1' })
  })

  it('does not add a folder condition for empty folderId', () => {
    const where = buildFileWhere('user-1', { folderId: '' })
    expect(where.AND).toBeUndefined()
  })

  it('requires every selected tag (AND semantics)', () => {
    const where = buildFileWhere('user-1', { tags: ['t1', 't2'] })
    expect(where.AND).toContainEqual({ tags: { some: { tagId: 't1' } } })
    expect(where.AND).toContainEqual({ tags: { some: { tagId: 't2' } } })
  })

  it('combines multiple filters', () => {
    const where = buildFileWhere('user-1', {
      search: 'doc',
      types: ['application/pdf'],
      folderId: 'f1',
      tags: ['t1'],
    })
    expect(where.userId).toBe('user-1')
    expect((where.AND as unknown[]).length).toBe(4)
  })
})

describe('buildFileOrderBy', () => {
  it('defaults to newest first', () => {
    expect(buildFileOrderBy(undefined)).toEqual({ uploadedAt: 'desc' })
    expect(buildFileOrderBy('newest')).toEqual({ uploadedAt: 'desc' })
  })

  it('maps each known sort option', () => {
    expect(buildFileOrderBy('oldest')).toEqual({ uploadedAt: 'asc' })
    expect(buildFileOrderBy('largest')).toEqual({ size: 'desc' })
    expect(buildFileOrderBy('smallest')).toEqual({ size: 'asc' })
    expect(buildFileOrderBy('most-viewed')).toEqual({ views: 'desc' })
    expect(buildFileOrderBy('least-viewed')).toEqual({ views: 'asc' })
    expect(buildFileOrderBy('most-downloaded')).toEqual({ downloads: 'desc' })
    expect(buildFileOrderBy('least-downloaded')).toEqual({ downloads: 'asc' })
    expect(buildFileOrderBy('name-asc')).toEqual({ name: 'asc' })
    expect(buildFileOrderBy('name')).toEqual({ name: 'asc' })
    expect(buildFileOrderBy('name-desc')).toEqual({ name: 'desc' })
  })

  it('falls back to newest for unknown options', () => {
    expect(buildFileOrderBy('nonsense')).toEqual({ uploadedAt: 'desc' })
  })
})
