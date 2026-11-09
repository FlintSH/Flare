import { UpdateProfileSchema } from '@/types/dto/profile'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { errorResponse } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import { effectiveUploadRevision } from '@/lib/uploads/effective-settings'
import { uploadRoutes } from '@/lib/uploads/http'
import { uploadLinks } from '@/lib/uploads/links'
import {
  applyUploadOverrides,
  parseUploadFields,
  requestUploadOptions,
  resolveUploadOptions,
} from '@/lib/uploads/options'
import { ProfileNotFoundError } from '@/lib/uploads/profiles'
import {
  expirationDate,
  mergeUploadOptions,
  uploadProfileInputSchema,
  uploadProfileOptionsSchema,
  uploadRecipeSchema,
  uploadRequestOptionsSchema,
} from '@/lib/uploads/schema'

const database = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  uploadProfile: { findFirst: vi.fn() },
  vaultFolder: { findFirst: vi.fn() },
}))
const validateOwnedTagIds = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/service', () => ({
  validateOwnedTagIds,
  TagError: class extends Error {},
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: database }))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'delivery' } } },
    },
  }),
}))

const user: AuthenticatedUser = {
  id: 'alice',
  storageUsed: 0,
  urlId: 'alice',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'session',
}
const now = new Date('2026-09-13T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.clearAllMocks()
  validateOwnedTagIds.mockImplementation(
    async (_userId: string, ids: string[]) => [...new Set(ids)]
  )
  database.user.findUnique.mockResolvedValue({
    randomizeFileUrls: true,
    defaultFileExpiration: 'WEEK',
    defaultFileExpirationAction: 'SET_PRIVATE',
    defaultUploadProfileId: 'profile-one',
  })
  database.uploadProfile.findFirst.mockResolvedValue({
    id: 'profile-one',
    options: { visibility: 'PRIVATE', expiration: 'DAY' },
    updatedAt: now,
  })
  database.vaultFolder.findFirst.mockResolvedValue({ id: 'marketing' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('portable profile and upload policy contracts', () => {
  it('validates upload folders against the owner without adding folder destinations to profiles', async () => {
    expect((await resolveUploadOptions(user)).folderId).toBeNull()
    expect(database.vaultFolder.findFirst).not.toHaveBeenCalled()
    const resolved = await resolveUploadOptions(user, { folderId: 'marketing' })
    expect(resolved.folderId).toBe('marketing')
    expect(database.vaultFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'marketing', userId: user.id },
      select: { id: true },
    })
    database.vaultFolder.findFirst.mockResolvedValue(null)
    await expect(
      resolveUploadOptions(user, { folderId: 'someone-elses-folder' })
    ).rejects.toMatchObject({ status: 404 })
    expect(() =>
      uploadProfileInputSchema.parse({
        name: 'Marketing',
        options: { folderId: 'marketing' },
      })
    ).toThrow()
  })

  it('reads saved profile options without the fields this version dropped', () => {
    expect(
      uploadProfileOptionsSchema.parse({
        visibility: 'PRIVATE',
        copyFormat: 'markdown',
        folderId: 'marketing',
      })
    ).toEqual({ visibility: 'PRIVATE' })
    expect(() =>
      uploadProfileOptionsSchema.parse({ visibility: 'HIDDEN' })
    ).toThrow()
    expect(
      uploadProfileInputSchema.parse({
        name: 'Older recipe',
        options: { visibility: 'PRIVATE', copyFormat: 'markdown' },
      }).options
    ).toEqual({ visibility: 'PRIVATE' })
  })

  it('answers saved profile options it cannot read with a logged 500', async () => {
    const logged = vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options: { visibility: 'HIDDEN', copyFormat: 'markdown' },
      updatedAt: now,
    })
    const failure = await resolveUploadOptions(user).catch((error) => error)
    const response = errorResponse(failure, uploadRoutes, 'POST /api/files')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Upload could not be completed.',
    })
    expect(logged).toHaveBeenCalledWith('POST /api/files failed', failure)

    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options: { visibility: 'PRIVATE', copyFormat: 'markdown' },
      updatedAt: now,
    })
    expect((await resolveUploadOptions(user)).visibility).toBe('PRIVATE')
  })

  it('answers request options it cannot read with a 400 the upload way', async () => {
    const failure = await resolveUploadOptions(user, {
      visibility: 'HIDDEN',
    } as never).catch((error) => error)
    const response = errorResponse(failure, uploadRoutes)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid upload options.' })
  })

  it('pins destinations throughout chunk completion, including explicit unfiled uploads', async () => {
    const resolved = await resolveUploadOptions(user, { folderId: 'marketing' })
    expect(applyUploadOverrides(user, resolved, {}).folderId).toBe('marketing')
    expect(
      applyUploadOverrides(user, resolved, { folderId: 'marketing' }).folderId
    ).toBe('marketing')
    expect(() =>
      applyUploadOverrides(user, resolved, { folderId: null })
    ).toThrow('folder cannot change')
    expect(() =>
      applyUploadOverrides(user, resolved, { folderId: 'other' })
    ).toThrow('folder cannot change')
    const legacySnapshot = { ...resolved }
    delete legacySnapshot.folderId
    expect(applyUploadOverrides(user, legacySnapshot, {}).folderId).toBeNull()
    expect(parseUploadFields({ folderId: '' })).toEqual({ folderId: null })
  })

  it('selects an upload folder before streaming and rejects conflicting destinations', () => {
    expect(
      requestUploadOptions(
        new Request('https://flare.test/api/files', {
          headers: { 'X-Upload-Folder': 'marketing' },
        })
      )
    ).toEqual({ folderId: 'marketing' })
    expect(
      requestUploadOptions(
        new Request('https://flare.test/api/files?folderId=marketing')
      )
    ).toEqual({ folderId: 'marketing' })
    expect(
      requestUploadOptions(
        new Request('https://flare.test/api/files?folderId=none')
      )
    ).toEqual({ folderId: null })
    expect(() =>
      requestUploadOptions(
        new Request('https://flare.test/api/files?folderId=marketing', {
          headers: { 'X-Upload-Folder': 'other' },
        })
      )
    ).toThrow('Conflicting upload folder')
  })

  it('keeps unconfigured uploads untagged, inherits profile tags, and allows explicit removal', () => {
    expect(mergeUploadOptions({}, {}, {}, now).tagIds).toEqual([])
    expect(
      mergeUploadOptions({}, { tagIds: ['work'] }, {}, now).tagIds
    ).toEqual(['work'])
    expect(
      mergeUploadOptions({}, { tagIds: ['work'] }, { tagIds: [] }, now).tagIds
    ).toEqual([])
  })

  it('validates both profile tags and explicit upload tags against the uploader', async () => {
    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options: { tagIds: ['work'] },
      updatedAt: now,
    })
    expect((await resolveUploadOptions(user)).tagIds).toEqual(['work'])
    expect(validateOwnedTagIds).toHaveBeenLastCalledWith('alice', ['work'])
    expect(
      (await resolveUploadOptions(user, { tagIds: ['personal'] })).tagIds
    ).toEqual(['personal'])
    expect(validateOwnedTagIds).toHaveBeenLastCalledWith('alice', ['personal'])
    validateOwnedTagIds.mockRejectedValueOnce(
      new Error('Tag does not belong to this account.')
    )
    await expect(
      resolveUploadOptions(user, { tagIds: ['another-owner'] })
    ).rejects.toThrow('this account')
  })

  it('compares bound-profile tags by value and prevents removal at either upload stage', async () => {
    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options: { tagIds: ['work', 'receipts'] },
      updatedAt: now,
    })
    const boundUser = {
      ...user,
      apiToken: {
        id: 'token',
        scopes: ['files:upload'],
        profileId: 'profile-one',
      },
    }
    const resolved = await resolveUploadOptions(boundUser, {
      tagIds: ['receipts', 'work'],
    })
    expect(
      applyUploadOverrides(boundUser, resolved, {
        tagIds: ['work', 'receipts'],
      }).tagIds
    ).toEqual(['work', 'receipts'])
    await expect(
      resolveUploadOptions(boundUser, { tagIds: [] })
    ).rejects.toMatchObject({ status: 403 })
    expect(() =>
      applyUploadOverrides(boundUser, resolved, { tagIds: [] })
    ).toThrow('cannot override')
  })

  it('parses multipart tags without treating omission as removal', () => {
    expect(parseUploadFields({ tagIds: '["work"]' })).toEqual({
      tagIds: ['work'],
    })
    expect(parseUploadFields({ tagIds: '[]' })).toEqual({ tagIds: [] })
    expect(parseUploadFields({})).not.toHaveProperty('tagIds')
    expect(() => parseUploadFields({ tagIds: 'work' })).toThrow('JSON array')
    expect(() => parseUploadFields({ tagIds: '"work"' })).toThrow()
    expect(() =>
      uploadRequestOptionsSchema.parse({ tagIds: new Array(21).fill('work') })
    ).toThrow()
  })

  it('combines account, profile and request values while preserving explicit false and disabled', () => {
    const result = mergeUploadOptions(
      {
        randomizeFileUrls: true,
        expiration: 'WEEK',
        expiryAction: 'SET_PRIVATE',
      },
      { visibility: 'PRIVATE', expiration: 'DAY' },
      { randomizeFileUrls: false, expiration: 'DISABLED' },
      now
    )
    expect(result).toMatchObject({
      visibility: 'PRIVATE',
      randomizeFileUrls: false,
      expiration: 'DISABLED',
      expiresAt: null,
      expiryAction: 'SET_PRIVATE',
    })
  })

  it('uses actual one-hour and one-day durations on the server', () => {
    expect(expirationDate('HOUR', now)).toBe('2026-09-13T13:00:00.000Z')
    expect(expirationDate('DAY', now)).toBe('2026-09-14T12:00:00.000Z')
    expect(expirationDate('WEEK', now)).toBe('2026-09-20T12:00:00.000Z')
    expect(expirationDate('MONTH', now)).toBe('2026-10-13T12:00:00.000Z')
    expect(
      UpdateProfileSchema.parse({ defaultFileExpiration: 'DISABLED' })
        .defaultFileExpiration
    ).toBe('DISABLED')
  })

  it('applies the saved default profile and instance share design to API uploads', async () => {
    const resolved = await resolveUploadOptions(user)
    expect(resolved).toMatchObject({
      profileId: 'profile-one',
      profileRevision: now.toISOString(),
      visibility: 'PRIVATE',
      shareStyle: 'delivery',
      expiration: 'DAY',
      expiryAction: 'SET_PRIVATE',
      expiresAt: '2026-09-14T12:00:00.000Z',
    })
    expect(database.uploadProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'profile-one', userId: 'alice' },
    })
  })

  it('distinguishes selecting account settings from inheriting the default profile', async () => {
    const resolved = await resolveUploadOptions(user, { profileId: null })
    expect(database.uploadProfile.findFirst).not.toHaveBeenCalled()
    expect(resolved).toMatchObject({
      profileId: null,
      visibility: 'PUBLIC',
      expiration: 'WEEK',
      shareStyle: 'delivery',
    })
  })

  it('does not fall back when an explicitly selected profile is missing or belongs to another account', async () => {
    database.uploadProfile.findFirst.mockResolvedValue(null)
    const missing = resolveUploadOptions(user, { profileId: 'another-owner' })
    // Archive requests recognise this error by its type.
    await expect(missing).rejects.toBeInstanceOf(ProfileNotFoundError)
    await expect(missing).rejects.toMatchObject({
      status: 404,
      message: 'Upload profile not found.',
    })
  })

  it('prevents bound credentials selecting a different profile, relaxing privacy, or bypassing expiration', async () => {
    const tokenUser = {
      ...user,
      apiToken: {
        id: 'token',
        scopes: ['files:upload'],
        profileId: 'profile-one',
      },
    }
    await expect(
      resolveUploadOptions(tokenUser, { profileId: null })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { visibility: 'PUBLIC' })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { expiration: 'DISABLED' })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { expiresAt: null })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { password: 'one-upload-only' })
    ).resolves.toMatchObject({
      visibility: 'PRIVATE',
      password: 'one-upload-only',
    })
  })

  it('pins a profile snapshot during transport and rejects late profile/naming changes', async () => {
    const resolved = await resolveUploadOptions(user)
    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options: { visibility: 'PUBLIC', shareStyle: 'minimal' },
      updatedAt: new Date('2026-09-14'),
    })
    const applied = applyUploadOverrides(user, resolved, {
      password: 'single-use',
    })
    expect(applied).toMatchObject({
      visibility: 'PRIVATE',
      shareStyle: 'delivery',
      expiresAt: resolved.expiresAt,
      profileRevision: resolved.profileRevision,
    })
    expect(() =>
      applyUploadOverrides(user, resolved, { profileId: 'other' })
    ).toThrow('cannot change')
    expect(() =>
      applyUploadOverrides(user, resolved, { randomizeFileUrls: false })
    ).toThrow('cannot change')
  })

  it('preserves multipart omission and explicit removal independently', () => {
    expect(parseUploadFields({})).toEqual({})
    expect(
      parseUploadFields({
        expiresAt: '',
        password: '',
        randomizeFileUrls: 'false',
        expiration: 'DISABLED',
      })
    ).toEqual({
      expiresAt: null,
      password: null,
      randomizeFileUrls: false,
      expiration: 'DISABLED',
    })
    expect(() => parseUploadFields({ visibility: 'PUBLIC<script>' })).toThrow()
    expect(() => parseUploadFields({ expiresAt: 'not-a-date' })).toThrow()
    expect(() =>
      uploadRequestOptionsSchema.parse({ password: '🔒'.repeat(19) })
    ).toThrow('72 bytes')
  })

  it('accepts profile selection before streaming and rejects contradictory headers/query', () => {
    expect(
      requestUploadOptions(
        new Request('https://flare.test/api/files?profileId=profile-one')
      )
    ).toEqual({ profileId: 'profile-one' })
    expect(
      requestUploadOptions(
        new Request('https://flare.test/api/files', {
          headers: { 'X-Upload-Profile': 'none' },
        })
      )
    ).toEqual({ profileId: null })
    expect(() =>
      requestUploadOptions(
        new Request('https://flare.test/api/files?profileId=a', {
          headers: { 'X-Upload-Profile': 'b' },
        })
      )
    ).toThrow('Conflicting')
  })

  it.each(['page', 'raw', 'download', 'markdown', 'html'])(
    'discards legacy %s copy formatting from saved profiles, recipes and uploads',
    async (copyFormat) => {
      const options = {
        visibility: 'PRIVATE' as const,
        expiration: 'DAY' as const,
      }
      database.uploadProfile.findFirst.mockResolvedValue({
        id: 'profile-one',
        options: { ...options, copyFormat },
        updatedAt: now,
      })
      const resolved = await resolveUploadOptions(user)
      expect(resolved).toMatchObject(options)
      expect(resolved).not.toHaveProperty('copyFormat')
      expect(
        uploadProfileOptionsSchema.parse({ ...options, copyFormat })
      ).toEqual(options)
      const recipe = uploadRecipeSchema.parse({
        format: 'flare-upload-profile',
        version: 1,
        profile: {
          name: 'Old screenshots',
          options: { ...options, copyFormat },
        },
      })
      expect(recipe.profile.options).toEqual(options)
      expect(uploadRequestOptionsSchema.parse({ copyFormat })).toEqual({})
      expect(parseUploadFields({ copyFormat })).toEqual({})

      // A chunk upload started on an older release can still contain this key.
      const legacySnapshot = { ...resolved, copyFormat }
      const completed = applyUploadOverrides(user, legacySnapshot, {})
      expect(completed).not.toHaveProperty('copyFormat')
      expect(completed).toMatchObject({
        ...options,
        expiresAt: resolved.expiresAt,
      })
    }
  )

  it('rejects recipes carrying secrets, unknown code/settings, or unsupported versions', () => {
    const recipe = {
      format: 'flare-upload-profile',
      version: 1,
      profile: { name: 'Screenshots', options: { expiration: 'DAY' } },
    }
    expect(uploadRecipeSchema.parse(recipe)).toEqual(recipe)
    expect(() => uploadRecipeSchema.parse({ ...recipe, version: 2 })).toThrow()
    expect(() =>
      uploadRecipeSchema.parse({
        ...recipe,
        profile: { ...recipe.profile, options: { password: 'secret' } },
      })
    ).toThrow()
    expect(() =>
      uploadRecipeSchema.parse({ ...recipe, script: 'alert(1)' })
    ).toThrow()
  })
})

describe('name patterns in upload options', () => {
  const patternProfile = (options: object) =>
    database.uploadProfile.findFirst.mockResolvedValue({
      id: 'profile-one',
      options,
      updatedAt: now,
    })
  const tokenUser = {
    ...user,
    apiToken: {
      id: 'token',
      scopes: ['files:upload'],
      profileId: 'profile-one',
    },
  }

  it('accepts a pattern in profiles, recipes and requests, and explains a bad one', () => {
    const options = { nameTemplate: 'shot-{date}-{random:4}' }
    expect(uploadProfileOptionsSchema.parse(options)).toEqual(options)
    expect(
      uploadProfileInputSchema.parse({ name: 'Shots', options }).options
    ).toEqual(options)
    expect(
      uploadRecipeSchema.parse({
        format: 'flare-upload-profile',
        version: 1,
        profile: { name: 'Shots', options },
      }).profile.options
    ).toEqual(options)
    expect(parseUploadFields({ nameTemplate: '{words:2}' })).toEqual({
      nameTemplate: '{words:2}',
    })
    expect(parseUploadFields({ nameTemplate: '' })).toEqual({})

    const refused = uploadProfileInputSchema.safeParse({
      name: 'Shots',
      options: { nameTemplate: '{date}/{random}' },
    })
    expect(refused.error?.issues[0]?.message).toMatch('Remove “/”.')
    for (const nameTemplate of ['', null, 7])
      expect(
        uploadRequestOptionsSchema.safeParse({ nameTemplate }).success
      ).toBe(false)
  })

  it('reads a pattern for one upload from its header or query before streaming', () => {
    const request = (query: string, header?: string) =>
      new Request(`http://flare.test/api/files${query}`, {
        method: 'POST',
        headers: header ? { 'X-Upload-Name-Template': header } : {},
      })
    expect(requestUploadOptions(request('', '{date}-{words:2}'))).toEqual({
      nameTemplate: '{date}-{words:2}',
    })
    expect(
      requestUploadOptions(request('?nameTemplate=%7Bname%7D-%7Brandom%3A4%7D'))
    ).toEqual({ nameTemplate: '{name}-{random:4}' })
    expect(
      requestUploadOptions(request('?nameTemplate=%7Bdate%7D', '{date}'))
    ).toEqual({ nameTemplate: '{date}' })
    expect(() =>
      requestUploadOptions(request('?nameTemplate=%7Bdate%7D', '{time}'))
    ).toThrow('Conflicting name pattern selections.')
    expect(() => requestUploadOptions(request('', '{date}.png'))).toThrow(
      'Remove “.”.'
    )
    expect(requestUploadOptions(request('?nameTemplate='))).toEqual({})
  })

  it('refuses a pattern together with random names, but not with original names', () => {
    const both = uploadRequestOptionsSchema.safeParse({
      nameTemplate: '{date}',
      randomizeFileUrls: true,
    })
    expect(both.error?.issues[0]).toMatchObject({
      path: ['nameTemplate'],
      message: 'Choose a name pattern or random names, not both.',
    })
    expect(
      uploadRequestOptionsSchema.parse({
        nameTemplate: '{date}',
        randomizeFileUrls: false,
      })
    ).toEqual({ nameTemplate: '{date}', randomizeFileUrls: false })
  })

  it('answers an upload whose pattern is wrong with the reason', async () => {
    const failure = await resolveUploadOptions(user, {
      nameTemplate: '{uuid}',
    }).catch((error) => error)
    const response = errorResponse(failure, uploadRoutes)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(
      '{uuid} is not a placeholder.'
    )
  })

  it('lets the most specific layer that names a strategy decide it whole', () => {
    const naming = (...layers: Parameters<typeof mergeUploadOptions>) => {
      const { randomizeFileUrls, nameTemplate } = mergeUploadOptions(...layers)
      return { randomizeFileUrls, nameTemplate }
    }
    expect(naming({}, {}, {})).toEqual({
      randomizeFileUrls: false,
      nameTemplate: null,
    })
    expect(
      naming({ randomizeFileUrls: true }, { nameTemplate: '{date}' }, {})
    ).toEqual({ randomizeFileUrls: false, nameTemplate: '{date}' })
    expect(
      naming({}, { nameTemplate: '{date}' }, { randomizeFileUrls: true })
    ).toEqual({ randomizeFileUrls: true, nameTemplate: null })
    expect(
      naming({}, { nameTemplate: '{date}' }, { randomizeFileUrls: false })
    ).toEqual({ randomizeFileUrls: false, nameTemplate: null })
    expect(
      naming({}, { randomizeFileUrls: true }, { nameTemplate: '{words}' })
    ).toEqual({ randomizeFileUrls: false, nameTemplate: '{words}' })
    expect(
      naming({}, { nameTemplate: '{date}' }, { visibility: 'PRIVATE' })
    ).toEqual({ randomizeFileUrls: false, nameTemplate: '{date}' })
    // A profile saved by hand with both keeps its pattern.
    expect(
      naming({}, { nameTemplate: '{date}', randomizeFileUrls: true }, {})
    ).toEqual({ randomizeFileUrls: false, nameTemplate: '{date}' })
  })

  it('uses a profile pattern over the account’s random names', async () => {
    patternProfile({ nameTemplate: '{date}-{random}' })
    await expect(resolveUploadOptions(user)).resolves.toMatchObject({
      randomizeFileUrls: false,
      nameTemplate: '{date}-{random}',
    })
    await expect(
      resolveUploadOptions(user, { randomizeFileUrls: true })
    ).resolves.toMatchObject({ randomizeFileUrls: true, nameTemplate: null })
    await expect(
      resolveUploadOptions(user, { profileId: null })
    ).resolves.toMatchObject({ randomizeFileUrls: true, nameTemplate: null })
  })

  it('keeps a bound token on its profile’s naming, pattern or not', async () => {
    patternProfile({ nameTemplate: '{date}-{random}' })
    for (const request of [
      { randomizeFileUrls: false },
      { randomizeFileUrls: true },
      { nameTemplate: '{name}' },
    ])
      await expect(
        resolveUploadOptions(tokenUser, request)
      ).rejects.toMatchObject({
        status: 403,
        message: 'This token cannot override its upload profile.',
      })
    await expect(
      resolveUploadOptions(tokenUser, { nameTemplate: '{date}-{random}' })
    ).resolves.toMatchObject({ nameTemplate: '{date}-{random}' })

    // The account names files at random and the profile says nothing.
    patternProfile({ visibility: 'PRIVATE' })
    await expect(
      resolveUploadOptions(tokenUser, { nameTemplate: '{name}' })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { randomizeFileUrls: false })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveUploadOptions(tokenUser, { randomizeFileUrls: true })
    ).resolves.toMatchObject({ randomizeFileUrls: true, nameTemplate: null })
  })

  it('refuses a different naming choice once an upload has started', async () => {
    patternProfile({ nameTemplate: '{date}-{random}' })
    const resolved = await resolveUploadOptions(user)
    for (const request of [
      { randomizeFileUrls: false },
      { randomizeFileUrls: true },
      { nameTemplate: '{name}' },
    ])
      expect(() => applyUploadOverrides(user, resolved, request)).toThrow(
        'The naming strategy cannot change after upload starts.'
      )
    expect(
      applyUploadOverrides(user, resolved, { nameTemplate: '{date}-{random}' })
    ).toMatchObject({ nameTemplate: '{date}-{random}' })
    expect(
      applyUploadOverrides(user, resolved, { visibility: 'PUBLIC' })
    ).toMatchObject({ visibility: 'PUBLIC', nameTemplate: '{date}-{random}' })
    expect(() =>
      applyUploadOverrides(tokenUser, resolved, { randomizeFileUrls: false })
    ).toThrow('The naming strategy cannot change after upload starts.')
  })

  it('completes an upload that started before patterns existed', async () => {
    patternProfile({ visibility: 'PRIVATE' })
    const { nameTemplate: _later, ...started } =
      await resolveUploadOptions(user)
    const earlier = started as typeof started & { nameTemplate: null }
    expect(
      applyUploadOverrides(user, earlier, { randomizeFileUrls: true })
    ).toMatchObject({ randomizeFileUrls: true, nameTemplate: null })
    expect(() =>
      applyUploadOverrides(user, earlier, { nameTemplate: '{name}' })
    ).toThrow('The naming strategy cannot change after upload starts.')
  })

  it('changes a profile’s reviewed revision only when a pattern is involved', () => {
    const revision = (profile: object) =>
      effectiveUploadRevision('alice', 'profile-one', {}, profile, true)
    // The digest Flare computed for these settings before patterns existed.
    expect(revision({ visibility: 'PRIVATE' })).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            version: 1,
            userId: 'alice',
            profileId: 'profile-one',
            visibility: 'PRIVATE',
            expiration: 'DISABLED',
            expiryAction: 'DELETE',
            randomizeFileUrls: false,
            shareStyle: 'framed',
            tagIds: [],
          })
        )
        .digest('hex')
    )
    expect(revision({ nameTemplate: '{date}' })).not.toBe(revision({}))
    expect(revision({ nameTemplate: '{date}' })).not.toBe(
      revision({ nameTemplate: '{words}' })
    )
    expect(
      effectiveUploadRevision(
        'alice',
        'profile-one',
        { nameTemplate: '{date}' },
        { randomizeFileUrls: false },
        true
      )
    ).toBe(revision({}))
  })
})

describe('upload link outputs', () => {
  const file = {
    id: 'file-id',
    urlPath: '/alice/example.txt',
    name: 'hello [world]',
    mimeType: 'text/plain',
    size: 1,
  }

  it('returns the vanity share page for all copied links, including legacy clients', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example/')
    const output = uploadLinks(file, { ...user, vanityId: 'orbit' })
    expect(output).toMatchObject({
      url: 'https://files.example/orbit/example.txt',
      pageUrl: 'https://files.example/orbit/example.txt',
      copyText: 'https://files.example/orbit/example.txt',
      rawUrl: 'https://files.example/api/files/alice/example.txt',
      downloadUrl: 'https://files.example/api/files/file-id/download',
      size: 1024 * 1024,
    })
  })

  it('encodes the share URL without adding display-name markup', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example/')
    // New URL names can't hold these characters; the library spells older
    // ones the same way.
    const output = uploadLinks(
      { ...file, urlPath: '/alice/a file #1 (draft).txt', name: '<img src=x>' },
      user
    )
    expect(output.url).toBe(
      'https://files.example/alice/a%20file%20%231%20(draft).txt'
    )
    expect(output.copyText).toBe(output.url)
    expect(output.pageUrl).toBe(output.url)
  })
})
