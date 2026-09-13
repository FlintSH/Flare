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
  uploadRecipeSchema,
  uploadRequestOptionsSchema,
} from '@/lib/uploads/schema'

const database = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  uploadProfile: { findFirst: vi.fn() },
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
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('portable profile and upload policy contracts', () => {
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
  it('preserves a real legacy URL while supplying markup as explicit copy text', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example/')
    const file = {
      id: 'file-id',
      urlPath: '/alice/example.txt',
      name: 'hello [world]',
      mimeType: 'text/plain',
      size: 1,
    }
    const output = uploadLinks(
      file,
      { ...user, vanityId: 'orbit' },
      { copyFormat: 'markdown' }
    )
    expect(output.url).toBe('https://files.example/orbit/example.txt')
    expect(output.copyText).toBe(
      '[hello \\[world\\]](https://files.example/orbit/example.txt)'
    )
    expect(output.size).toBe(1024 * 1024)
    const html = uploadLinks(
      { ...file, name: '<img onerror="alert(1)">' },
      user,
      { copyFormat: 'html' }
    )
    expect(html.copyText).toContain('&lt;img onerror=&quot;alert(1)&quot;&gt;')
    expect(html.copyText).not.toContain('<img')
    const unusual = uploadLinks(
      { ...file, urlPath: '/alice/file.txt)(injected)', name: '<img src=x>' },
      user,
      { copyFormat: 'markdown' }
    )
    expect(unusual.copyText).toBe(
      '[\\<img src=x\\>](https://files.example/alice/file.txt%29%28injected%29)'
    )
  })
})
