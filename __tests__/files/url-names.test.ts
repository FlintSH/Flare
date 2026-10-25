import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'

// Paths stored before per-upload object directories (#199). Earlier builds
// looked these up to choose a collision name.
const legacy = vi.hoisted(() => ({ paths: new Set<string>() }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findFirst: async ({ where }: { where: { path: string } }) =>
        legacy.paths.has(where.path) ? { id: 'legacy-file' } : null,
    },
  },
}))

const { prepareUploadDestination } = await import('@/lib/uploads/finalize')
const { UPLOAD_DEFAULTS } = await import('@/lib/uploads/schema')

const owner = { urlId: 'owner' } as AuthenticatedUser
const options = (randomizeFileUrls = false) => ({
  ...UPLOAD_DEFAULTS,
  randomizeFileUrls,
  profileId: null,
  profileRevision: null,
  expiresAt: null,
  password: null,
})

async function urlName(filename: string, randomize = false) {
  const destination = await prepareUploadDestination(
    owner,
    filename,
    options(randomize)
  )
  expect(destination.urlPath).toBe(`/owner/${destination.urlSafeName}`)
  expect(destination.filePath).toMatch(
    new RegExp(`^uploads/owner/[0-9a-f-]{36}/${destination.urlSafeName}$`)
  )
  expect(destination.displayName).toBe(filename)
  return destination.urlSafeName
}

const RANDOM = '[A-Za-z0-9_-]{6}'

beforeEach(() => legacy.paths.clear())

describe('upload URL names', () => {
  it('keeps the established names for ordinary filenames', async () => {
    expect(await urlName('My Report.PDF')).toBe('my-report.pdf')
    expect(await urlName('photo.jpg')).toBe('photo.jpg')
    expect(await urlName('archive.tar.gz')).toBe('archive-tar.gz')
    expect(await urlName('Screenshot 2026-10-25 at 10.15.42.png')).toBe(
      'screenshot-2026-10-25-at-10-15-42.png'
    )
    expect(await urlName('README')).toBe('readme')
    expect(await urlName('report.')).toBe('report')
  })

  it('builds the name from sanitized parts when an older file has the same path', async () => {
    legacy.paths.add('uploads/owner/my-report.pdf')
    // Earlier builds returned "My Report-1.PDF" here. Publication now gives a
    // taken URL its suffix under the owner's lock, like any other collision.
    expect(await urlName('My Report.PDF')).toMatch(/^[a-z0-9-]+\.pdf$/)
  })

  it('keeps only an extension made of ASCII letters and digits', async () => {
    expect(await urlName('notes.h#ml')).toBe('notes-h-ml')
    expect(await urlName('report.p hp')).toBe('report-p-hp')
    expect(await urlName('Meeting notes 2026.10.25 final version')).toBe(
      'meeting-notes-2026-10-25-final-version'
    )
    expect(await urlName('backup.verylongextension1')).toBe(
      'backup-verylongextension1'
    )
    expect(await urlName('backup.7z')).toBe('backup.7z')
  })

  it('gives names without ASCII letters or digits a random base instead of a dot-file name', async () => {
    expect(await urlName('日本語.txt')).toMatch(new RegExp(`^${RANDOM}\\.txt$`))
    expect(await urlName('日本語')).toMatch(new RegExp(`^${RANDOM}$`))
    expect(await urlName('!!!.PNG')).toMatch(new RegExp(`^${RANDOM}\\.png$`))
    expect(await urlName('.env')).toBe('env')
  })

  it('applies the same extension rule to randomized names', async () => {
    expect(await urlName('Photo.JPG', true)).toMatch(
      new RegExp(`^${RANDOM}\\.jpg$`)
    )
    expect(await urlName('notes.h#ml', true)).toMatch(new RegExp(`^${RANDOM}$`))
    expect(await urlName('日本語.txt', true)).toMatch(
      new RegExp(`^${RANDOM}\\.txt$`)
    )
  })
})
