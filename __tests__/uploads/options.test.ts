import { UpdateProfileSchema } from '@/types/dto/profile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { uploadLinks } from '@/lib/uploads/links'
import {
  applyUploadOverrides,
  parseUploadFields,
  requestUploadOptions,
  resolveUploadOptions,
} from '@/lib/uploads/options'
import {
  expirationDate,
  mergeUploadOptions,
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
  role: 'USER',
  randomizeFileUrls: false,
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
      uploadProfileOptionsSchema.parse({ folderId: 'marketing' })
    ).toThrow()
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
    await expect(
      resolveUploadOptions(user, { profileId: 'another-owner' })
    ).rejects.toMatchObject({ status: 404 })
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
    const output = uploadLinks(
      { ...file, urlPath: '/alice/a file.txt)(injected)', name: '<img src=x>' },
      user
    )
    expect(output.url).toBe(
      'https://files.example/alice/a%20file.txt%29%28injected%29'
    )
    expect(output.copyText).toBe(output.url)
    expect(output.pageUrl).toBe(output.url)
  })
})
