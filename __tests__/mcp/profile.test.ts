import { Prisma } from '@prisma/client'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import { DEFAULT_CONFIG } from '@/lib/config'
import {
  DEFAULT_PERSONAL_EMBED,
  type PersonalEmbed,
  readPersonalEmbed,
} from '@/lib/embeds/schema'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
import {
  TOOL_CATALOG,
  type ToolName,
  type ToolNeeds,
  type ToolRow,
  needsMet,
} from '@/lib/mcp/catalog'
import {
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from '@/lib/mcp/tool'
import { profileTools } from '@/lib/mcp/tools/profile'
import { uploadProfileTools } from '@/lib/mcp/tools/upload-profiles'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import type { TagView } from '@/lib/tags/schema'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  saveSettings: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  saveTheme: vi.fn(),
  saveEmbed: vi.fn(),
  embedsAllowed: vi.fn(),
  findFile: vi.fn(),
  stream: vi.fn(),
  user: vi.fn(),
  profiles: vi.fn(),
  profileNow: vi.fn(),
  tagNames: vi.fn(),
  tags: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
  save: vi.fn(),
  recheck: vi.fn(),
  fileNow: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.user },
    uploadProfile: { findMany: mocks.profiles, findFirst: mocks.profileNow },
    vaultTag: { findMany: mocks.tagNames },
  },
}))
/**
 * The transaction a service hands its check once it holds the account's row:
 * it reads the account and its profiles as the fakes below hold them then.
 */
const tx = {
  user: { findUnique: (...args: unknown[]) => mocks.user(...args) },
  uploadProfile: {
    findMany: (...args: unknown[]) => mocks.profiles(...args),
  },
  // The one statement written out in SQL: the avatar's file, as it is now.
  $queryRaw: (...args: unknown[]) => mocks.fileNow(...args),
}
type Check = (transaction: typeof tx) => Promise<void>
// The upload code merges an account's defaults with a profile; it reads the
// instance's share style from the settings.
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: async () => structuredClone(DEFAULT_CONFIG),
}))
vi.mock('@/lib/files/delivery', () => ({ findFile: mocks.findFile }))
vi.mock('@/lib/folders/service', () => ({ listFolders: vi.fn() }))
vi.mock('@/lib/tags/manage', () => ({ listTags: mocks.tags }))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getFileStream: mocks.stream }),
}))
// The real schemas read the arguments, as they read each route's body.
vi.mock('@/lib/users/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/users/profile')>()),
  accountToEdit: mocks.account,
  updateProfileSettings: mocks.saveSettings,
}))
vi.mock('@/lib/users/avatar', () => ({
  uploadAvatar: mocks.uploadAvatar,
  removeOwnAvatar: mocks.removeAvatar,
}))
vi.mock('@/lib/customization/personal', () => ({
  savePersonalAppearance: mocks.saveTheme,
}))
vi.mock('@/lib/embeds/personal', () => ({
  savePersonalEmbed: mocks.saveEmbed,
  personalEmbedsAllowed: mocks.embedsAllowed,
}))
// What the owner's role lets uploads be, read as the upload code reads it.
const owner = vi.hoisted(() => ({ shares: true }))
vi.mock('@/lib/permissions/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions/server')>()),
  getUserAccess: async () => ({
    roles: [],
    permissions: owner.shares ? ['files.share'] : [],
  }),
}))
vi.mock('@/lib/uploads/profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/profiles')>()),
  deleteProfile: mocks.remove,
  saveProfileAndDefault: mocks.save,
}))

const ORIGIN = 'https://flare.test'
const MB = 1024 * 1024

type Grant = { scopes: readonly string[]; permissions: readonly Permission[] }

/** The upload profile the calling token is bound to; null for one that is not. */
let boundTo: string | null

/** What a tool is handed for one call, with the catalog's own effect rule. */
function contextFor(name: ToolName, grant: Grant): ToolContext {
  const user = {
    id: 'owner',
    storageUsed: 0,
    urlId: 'alex',
    vanityId: null,
    permissions: [...grant.permissions],
    roles: [],
    randomizeFileUrls: false,
    credential: 'token' as const,
    apiToken: {
      id: 't1',
      scopes: [...grant.scopes, 'mcp'],
      profileId: boundTo,
    },
  }
  const principal = {
    user,
    name: 'Alex',
    scopes: grant.scopes,
    credentialKey: 'token:t1',
    can: (permission: Permission) => hasPermission(user, permission),
  }
  const effect = (effectName: string) => {
    const needs = (TOOL_CATALOG[name] as ToolRow).effects?.[effectName]
    if (!needs) throw new Error(`${name} has no effect called ${effectName}`)
    return needs
  }
  return {
    principal,
    request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
    origin: ORIGIN,
    moderating: null,
    mayModerate: false,
    requireModeration: () => {},
    allows: (effectName) => needsMet(effect(effectName), principal),
    // The server asks the credential and the role again; here a fake answers.
    recheck: (transaction) => mocks.recheck(transaction),
    requireEffect(effectName) {
      if (!needsMet(effect(effectName), principal))
        throw new ToolError(`Not allowed: ${effectName}`, 'denied')
    },
  }
}

/** The three account settings tools, in the order they are listed. */
const accountSettingsTools = [
  ...profileTools,
  ...uploadProfileTools,
] as ToolDefinition[]

const tool = (name: ToolName) =>
  accountSettingsTools.find((candidate) => candidate.name === name)!

/** What the tool's row asks for, and what the named effects ask for on top. */
function granted(name: ToolName, ...effects: string[]): Grant {
  const row: ToolRow = TOOL_CATALOG[name]
  const needs: ToolNeeds[] = [
    row,
    ...effects.map((effect) => row.effects![effect]),
  ]
  return {
    scopes: needs.flatMap(({ scopes }) => scopes),
    permissions: needs.flatMap(({ permissions }) => permissions),
  }
}

/** What choosing an avatar from a public file needs on top of the row. */
const AVATAR = granted('update_profile', 'avatar_file')

/**
 * Calls a tool the way the server does: arguments through its input schema,
 * inside a request's audit context. Without a grant the credential holds
 * what the tool's row asks for and no more. The answer must be exactly what
 * the output schema describes, with nothing left over.
 */
async function call(name: ToolName, args: unknown, grant?: Grant) {
  const audit: AuditContext = {}
  const context = contextFor(name, grant ?? granted(name))
  const { structured } = await auditContext.run(audit, () =>
    tool(name).run(tool(name).input.parse(args) as never, context)
  )
  expect(tool(name).output.parse(structured)).toEqual(structured)
  return { structured: structured as Record<string, never>, audit }
}

/** The refusal of a call, which must be one worded for the agent. */
async function refusal(name: ToolName, args: unknown, grant?: Grant) {
  const error = await call(name, args, grant).then(
    () => null,
    (thrown: unknown) => thrown
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

/** The account as the database holds it; the fakes below save into it. */
type AccountRow = {
  id: string
  name: string | null
  vanityId: string | null
  randomizeFileUrls: boolean
  defaultFileExpiration: 'DISABLED' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH'
  defaultFileExpirationAction: 'DELETE' | 'SET_PRIVATE'
  image: string | null
  preferences: Record<string, unknown>
  defaultUploadProfileId: string | null
}
let row: AccountRow

const saved = (id: string, name: string, options = {}, at = '10:00:00') => ({
  id,
  userId: 'owner',
  name,
  options,
  createdAt: new Date('2026-11-01T09:00:00.000Z'),
  updatedAt: new Date(`2026-11-20T${at}.000Z`),
})
let profiles: ReturnType<typeof saved>[]

const tag = (id: string, name: string): TagView => ({
  id,
  name,
  ruleSource: null,
  ruleText: null,
  fileCount: 0,
})
const TAGS = [tag('t-work', 'Work'), tag('t-old', 'Old')]

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(64, 7),
])
const image = {
  id: 'f-me',
  userId: 'owner',
  name: 'me.png',
  mimeType: 'image/png',
  size: PNG.length / MB,
  path: 'alex/key/me.png',
  visibility: 'PUBLIC' as 'PUBLIC' | 'PRIVATE',
  password: null as string | null,
}

/** Every service that changes something. A refused call reaches none. */
const writes = [
  'saveSettings',
  'uploadAvatar',
  'removeAvatar',
  'saveTheme',
  'saveEmbed',
  'create',
  'update',
  'remove',
  'setDefault',
] as const
/**
 * The services that saved, in order. A service that runs a check saves only
 * once its check passes, as the real ones write only after it.
 */
let written: string[]
function expectNothingChanged() {
  expect(written).toEqual([])
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
  boundTo = null
  owner.shares = true
  written = []
  row = {
    id: 'owner',
    name: 'Alex',
    vanityId: null,
    randomizeFileUrls: false,
    defaultFileExpiration: 'DISABLED',
    defaultFileExpirationAction: 'DELETE',
    image: null,
    preferences: {},
    defaultUploadProfileId: null,
  }
  profiles = [
    saved('p-private', 'Private', { visibility: 'PRIVATE' }),
    saved(
      'p-screens',
      'Screenshots',
      {
        visibility: 'PUBLIC',
        expiration: 'WEEK',
        expiryAction: 'SET_PRIVATE',
        randomizeFileUrls: true,
        shareStyle: 'minimal',
        tagIds: ['t-work'],
      },
      '11:30:00'
    ),
  ]
  mocks.account.mockImplementation(async () => ({ ...row }))
  mocks.user.mockImplementation(async () => ({ ...row }))
  mocks.embedsAllowed.mockResolvedValue(true)
  mocks.saveSettings.mockImplementation(async (_seen, settings, prove) => {
    await prove?.({ ...row }, tx)
    written.push('saveSettings')
    if (settings.name !== undefined) row.name = settings.name
    if (settings.vanityId !== undefined) row.vanityId = settings.vanityId
    if (settings.randomizeFileUrls !== undefined)
      row.randomizeFileUrls = settings.randomizeFileUrls
    if (settings.defaultFileExpiration)
      row.defaultFileExpiration = settings.defaultFileExpiration
    if (settings.defaultFileExpirationAction)
      row.defaultFileExpirationAction = settings.defaultFileExpirationAction
  })
  mocks.saveTheme.mockImplementation(
    async (_id, customization, check?: Check) => {
      await check?.(tx)
      written.push('saveTheme')
      row.preferences = { ...row.preferences, customization }
    }
  )
  // As the service saves it: a whole embed, or a change to the one saved.
  mocks.saveEmbed.mockImplementation(
    async (
      _id,
      embed: PersonalEmbed | ((current: PersonalEmbed) => PersonalEmbed),
      check?: Check
    ) => {
      await check?.(tx)
      written.push('saveEmbed')
      const value =
        typeof embed === 'function'
          ? embed(readPersonalEmbed(row.preferences))
          : embed
      row.preferences = { ...row.preferences, embed: value }
      return value
    }
  )
  // Every service runs the check it is handed before it writes, as the real
  // ones do with the account's row locked.
  mocks.uploadAvatar.mockImplementation(async (_id, _bytes, check?: Check) => {
    await check?.(tx)
    written.push('uploadAvatar')
    row.image = '/api/avatars/owner-new.jpg'
    return row.image
  })
  mocks.removeAvatar.mockImplementation(async (_id, check?: Check) => {
    await check?.(tx)
    written.push('removeAvatar')
    row.image = null
  })
  mocks.findFile.mockImplementation(async ({ id }: { id: string }) =>
    id === image.id ? image : null
  )
  mocks.stream.mockImplementation(async () => Readable.from([PNG]))
  mocks.fileNow.mockImplementation(async () => [
    { visibility: image.visibility, password: image.password },
  ])
  mocks.profiles.mockImplementation(async () => profiles)
  // One of the account's profiles by ID, as the database would find it.
  mocks.profileNow.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      (where.userId === 'owner' &&
        profiles.find((profile) => profile.id === where.id)) ||
      null
  )
  mocks.tags.mockResolvedValue(TAGS)
  mocks.tagNames.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      TAGS.filter(({ id }) => where.id.in.includes(id))
  )
  const view = (
    profile: ReturnType<typeof saved>,
    input: { name: string; options: object },
    at: string
  ) => ({ id: profile.id, ...input, updatedAt: `2026-11-22T${at}.000Z` })
  // A new profile is there for the next check; the first one is p-new.
  mocks.create.mockImplementation(async (_id, input) => {
    written.push('create')
    const made = profiles.filter(({ id }) => id.startsWith('p-new')).length
    const id = made ? `p-new-${made + 1}` : 'p-new'
    profiles.push(saved(id, input.name, input.options))
    return view(saved(id, input.name), input, '08:00:00')
  })
  mocks.update.mockImplementation(async (_id, id, _revision, input) => {
    written.push('update')
    return view(
      profiles.find((profile) => profile.id === id)!,
      input,
      '08:30:00'
    )
  })
  mocks.remove.mockImplementation(async (_id, id, check?: Check) => {
    await check?.(tx)
    written.push('remove')
    const found = profiles.some((profile) => profile.id === id)
    profiles = profiles.filter((profile) => profile.id !== id)
    if (row.defaultUploadProfileId === id) row.defaultUploadProfileId = null
    return found
  })
  mocks.setDefault.mockImplementation(async (_id, id) => {
    written.push('setDefault')
    row.defaultUploadProfileId = id
  })
  mocks.save.mockImplementation(saveTogether)
})

/**
 * `saveProfileAndDefault` as the service runs it, in one transaction: the
 * revision, then the check, then the profile and the default, each step a
 * fake above. A failure anywhere leaves everything as it was.
 */
async function saveTogether(
  userId: string,
  save: {
    id: string | null
    revision?: string
    input?: { name: string; options: object }
    makeDefault?: boolean
  },
  check?: Check
) {
  const kept = {
    row: { ...row },
    profiles: [...profiles],
    written: [...written],
  }
  try {
    const current = save.id
      ? profiles.find((profile) => profile.id === save.id)
      : undefined
    if (
      save.id &&
      save.revision !== undefined &&
      current?.updatedAt.getTime() !== new Date(save.revision).getTime()
    )
      throw new HttpError(409, 'Profile changed or was removed.')
    await check?.(tx)
    const profile = !save.id
      ? await mocks.create(userId, save.input)
      : save.input
        ? await mocks.update(userId, save.id, save.revision, save.input)
        : {
            id: current!.id,
            name: current!.name,
            options: current!.options,
            updatedAt: current!.updatedAt.toISOString(),
          }
    if (save.makeDefault) await mocks.setDefault(userId, profile.id)
    else if (
      save.makeDefault === false &&
      row.defaultUploadProfileId === profile.id
    )
      await mocks.setDefault(userId, null)
    return { profile, defaultId: row.defaultUploadProfileId }
  } catch (error) {
    row = kept.row
    profiles = kept.profiles
    written = kept.written
    throw error
  }
}

describe('update_profile', () => {
  const settled = {
    randomize_file_urls: false,
    default_expiry: 'never',
    default_expiry_action: 'delete',
    theme_mode: 'inherit',
    embed: { mode: 'inherit', design: 'inherit' },
    personal_embeds: true,
  }

  describe('what each argument saves', () => {
    it('sends the name, vanity ID and upload defaults as the profile route sends them', async () => {
      const { structured, audit } = await call(
        'update_profile',
        {
          name: '  Mira  ',
          vanity_id: 'mira-files',
          randomize_file_urls: true,
          default_expiry: 'week',
          default_expiry_action: 'make_private',
        },
        // A new length needs what either action needs.
        granted(
          'update_profile',
          'default_expiry_make_private',
          'default_expiry_delete'
        )
      )
      expect(mocks.saveSettings).toHaveBeenCalledExactlyOnceWith(
        // The account as it was read, which the save compares against.
        expect.objectContaining({ id: 'owner', name: 'Alex' }),
        {
          name: 'Mira',
          vanityId: 'mira-files',
          randomizeFileUrls: true,
          defaultFileExpiration: 'WEEK',
          defaultFileExpirationAction: 'SET_PRIVATE',
        },
        // What the new defaults do to every upload, judged under the lock.
        expect.any(Function)
      )
      expect(structured).toEqual({
        ...settled,
        name: 'Mira',
        vanity_id: 'mira-files',
        randomize_file_urls: true,
        default_expiry: 'week',
        default_expiry_action: 'make_private',
      })
      expect(audit).toMatchObject({
        targetType: 'user',
        targetId: 'owner',
        targetName: 'Alex',
      })
      for (const other of writes.filter((name) => name !== 'saveSettings'))
        expect(mocks[other], other).not.toHaveBeenCalled()
    })

    it('sends only what the call names', async () => {
      await call('update_profile', { randomize_file_urls: false })
      expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
        randomizeFileUrls: false,
      })
      expect(
        Object.entries(mocks.saveSettings.mock.calls[0][1]).filter(
          ([, value]) => value !== undefined
        )
      ).toEqual([['randomizeFileUrls', false]])
    })

    it('sets a vanity ID with a string and clears it with null', async () => {
      await call('update_profile', { vanity_id: 'Mira-2' })
      expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
        vanityId: 'Mira-2',
      })
      const { structured } = await call('update_profile', { vanity_id: null })
      expect(mocks.saveSettings.mock.calls[1][1]).toEqual({ vanityId: null })
      expect(structured).not.toHaveProperty('vanity_id')
    })

    it.each([
      ['never', 'DISABLED'],
      ['hour', 'HOUR'],
      ['day', 'DAY'],
      ['week', 'WEEK'],
      ['month', 'MONTH'],
    ])('saves a default expiry of %s as %s', async (word, stored) => {
      const { structured } = await call(
        'update_profile',
        { default_expiry: word },
        granted(
          'update_profile',
          'default_expiry_delete',
          'default_expiry_make_private'
        )
      )
      expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
        defaultFileExpiration: stored,
      })
      expect(structured.default_expiry).toBe(word)
    })

    it.each([
      ['delete', 'DELETE', 'default_expiry_delete'],
      ['make_private', 'SET_PRIVATE', 'default_expiry_make_private'],
    ])(
      'saves a default expiry action of %s as %s',
      async (word, stored, effect) => {
        row.defaultFileExpiration = 'DAY'
        const { structured } = await call(
          'update_profile',
          { default_expiry_action: word },
          granted('update_profile', effect)
        )
        expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
          defaultFileExpirationAction: stored,
        })
        expect(structured.default_expiry_action).toBe(word)
      }
    )

    it.each(['inherit', 'system', 'light', 'dark'])(
      'saves the theme mode %s as the preferences route does',
      async (mode) => {
        const { structured } = await call(
          'update_profile',
          { theme_mode: mode },
          granted('update_profile', 'theme_mode')
        )
        expect(mocks.saveTheme).toHaveBeenCalledExactlyOnceWith(
          'owner',
          { themeMode: mode },
          expect.any(Function)
        )
        expect(structured.theme_mode).toBe(mode)
        for (const other of writes.filter((name) => name !== 'saveTheme'))
          expect(mocks[other], other).not.toHaveBeenCalled()
      }
    )

    it('saves the whole embed the embed route takes, with what the call leaves out as it was saved', async () => {
      row.preferences = {
        customization: { themeMode: 'dark' },
        embed: { mode: 'direct', design: 'custom', title: 'Old', color: '' },
      }
      const { structured } = await call(
        'update_profile',
        {
          embed: {
            mode: 'rich',
            site_name: '{{instanceName}}',
            author: 'Mira',
            description: '{{size}}',
            color: '#12ab34',
          },
        },
        granted('update_profile', 'embed')
      )
      expect(mocks.saveEmbed).toHaveBeenCalledOnce()
      expect(row.preferences.embed).toEqual({
        mode: 'rich',
        design: 'custom',
        siteName: '{{instanceName}}',
        author: 'Mira',
        title: 'Old',
        description: '{{size}}',
        color: '#12ab34',
      })
      expect(structured.embed).toEqual({
        mode: 'rich',
        design: 'custom',
        site_name: '{{instanceName}}',
        author: 'Mira',
        title: 'Old',
        description: '{{size}}',
        color: '#12ab34',
      })
      // The theme saved beside it is read back, not touched.
      expect(structured.theme_mode).toBe('dark')
      expect(mocks.saveTheme).not.toHaveBeenCalled()
    })

    it('keeps an embed line saved elsewhere after the call read the account', async () => {
      row.preferences = { embed: { mode: 'direct', title: 'Old' } }
      // The owner saves the author line in the browser while the call runs.
      mocks.account.mockImplementationOnce(async () => {
        const seen = { ...row }
        row.preferences = {
          embed: { mode: 'direct', title: 'Old', author: 'Browser' },
        }
        return seen
      })
      await call(
        'update_profile',
        { embed: { title: 'New' } },
        granted('update_profile', 'embed')
      )
      expect(row.preferences.embed).toEqual({
        ...DEFAULT_PERSONAL_EMBED,
        mode: 'direct',
        title: 'New',
        author: 'Browser',
      })
    })

    it('refuses, and does not log, an embed that the saved one makes invalid under the lock', async () => {
      // As if a save elsewhere left a line the merge cannot keep.
      mocks.saveEmbed.mockImplementationOnce(async (_id, change) => {
        written.push('saveEmbed')
        return change({ ...DEFAULT_PERSONAL_EMBED, color: 'teal' })
      })
      const error = await refusal(
        'update_profile',
        { embed: { title: 'New' } },
        granted('update_profile', 'embed')
      )
      expect(error.message).toBe(
        '`embed.color`: Use a six-digit hex color. Nothing was changed.'
      )
      expect(loggers.api.error).not.toHaveBeenCalled()
    })

    it('starts from the default embed and clears a line with an empty string', async () => {
      await call(
        'update_profile',
        { embed: { design: 'custom', title: 'Hi' } },
        granted('update_profile', 'embed')
      )
      expect(row.preferences.embed).toEqual({
        ...DEFAULT_PERSONAL_EMBED,
        design: 'custom',
        title: 'Hi',
      })
      const { structured } = await call(
        'update_profile',
        { embed: { title: '' } },
        granted('update_profile', 'embed')
      )
      expect(row.preferences.embed).toEqual({
        ...DEFAULT_PERSONAL_EMBED,
        design: 'custom',
        title: '',
      })
      expect(structured.embed).toEqual({ mode: 'inherit', design: 'custom' })
    })

    it("makes one of the account's images the avatar, from the bytes in storage", async () => {
      const { structured } = await call(
        'update_profile',
        { avatar_file: 'f-me' },
        AVATAR
      )
      expect(mocks.findFile).toHaveBeenCalledExactlyOnceWith(
        { id: 'f-me' },
        expect.objectContaining({
          userId: true,
          mimeType: true,
          size: true,
          // Whether everyone can already open the file decides what it needs.
          visibility: true,
          password: true,
        })
      )
      // No more is asked of storage than an avatar may hold, plus one byte.
      expect(mocks.stream).toHaveBeenCalledExactlyOnceWith(
        'alex/key/me.png',
        { start: 0, end: 2 * MB },
        expect.any(AbortSignal)
      )
      expect(mocks.uploadAvatar).toHaveBeenCalledExactlyOnceWith(
        'owner',
        PNG,
        expect.any(Function)
      )
      expect(structured.avatar_url).toBe(
        'https://flare.test/api/avatars/owner-new.jpg'
      )
      for (const other of writes.filter((name) => name !== 'uploadAvatar'))
        expect(mocks[other], other).not.toHaveBeenCalled()
    })

    it('removes the avatar with null', async () => {
      row.image = '/api/avatars/owner-old.jpg'
      const { structured } = await call('update_profile', {
        avatar_file: null,
      })
      expect(mocks.removeAvatar).toHaveBeenCalledExactlyOnceWith(
        'owner',
        expect.any(Function)
      )
      expect(mocks.uploadAvatar).not.toHaveBeenCalled()
      expect(mocks.findFile).not.toHaveBeenCalled()
      expect(mocks.stream).not.toHaveBeenCalled()
      expect(structured).not.toHaveProperty('avatar_url')
    })

    it('saves the settings, then the avatar, then the theme, then the embed', async () => {
      await call(
        'update_profile',
        {
          embed: { mode: 'rich' },
          theme_mode: 'light',
          avatar_file: 'f-me',
          name: 'Mira',
        },
        granted('update_profile', 'theme_mode', 'embed', 'avatar_file')
      )
      const order = [
        mocks.saveSettings,
        mocks.uploadAvatar,
        mocks.saveTheme,
        mocks.saveEmbed,
      ].map((mock) => mock.mock.invocationCallOrder[0])
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(order).toHaveLength(4)
      expect(order.every(Number.isInteger)).toBe(true)
    })

    it('answers the settings as they now stand, whatever the call changed', async () => {
      row = {
        ...row,
        name: null,
        vanityId: 'alex',
        randomizeFileUrls: true,
        defaultFileExpiration: 'MONTH',
        defaultFileExpirationAction: 'SET_PRIVATE',
        image: 'https://cdn.example/avatars/owner.jpg',
        preferences: {
          customization: { themeMode: 'system' },
          embed: { mode: 'rich' },
        },
      }
      mocks.embedsAllowed.mockResolvedValue(false)
      const { structured } = await call('update_profile', { name: 'Alex' })
      expect(structured).toEqual({
        name: 'Alex',
        vanity_id: 'alex',
        randomize_file_urls: true,
        default_expiry: 'month',
        default_expiry_action: 'make_private',
        theme_mode: 'system',
        embed: { mode: 'rich', design: 'inherit' },
        personal_embeds: false,
        // Object storage and sign-in providers give a whole address.
        avatar_url: 'https://cdn.example/avatars/owner.jpg',
      })
    })
  })

  describe('what it will not take', () => {
    it('has an argument for nothing about signing in', () => {
      expect(Object.keys(tool('update_profile').input.shape).sort()).toEqual([
        'avatar_file',
        'default_expiry',
        'default_expiry_action',
        'embed',
        'name',
        'randomize_file_urls',
        'theme_mode',
        'vanity_id',
      ])
    })

    it.each([
      ['email', 'new@example.com'],
      ['password', 'a-new-password'],
      ['newPassword', 'a-new-password'],
      ['new_password', 'a-new-password'],
      ['currentPassword', 'the-old-password'],
      ['current_password', 'the-old-password'],
      ['securityCode', '123456'],
      ['url_id', 'abcde'],
      ['image', 'https://elsewhere.example/a.png'],
      ['roles', ['administrator']],
    ])('rejects the unknown argument %s', async (key, value) => {
      const { input } = tool('update_profile')
      expect(input.safeParse({ name: 'Mira', [key]: value }).success).toBe(
        false
      )
      await expect(
        call('update_profile', { name: 'Mira', [key]: value })
      ).rejects.toThrow()
      expectNothingChanged()
    })

    it('rejects an unknown embed field, and values outside each list', () => {
      const { input } = tool('update_profile')
      for (const args of [
        { embed: { html: '<script>' } },
        { embed: { mode: 'card' } },
        { theme_mode: 'sepia' },
        { default_expiry: 'year' },
        { default_expiry_action: 'archive' },
        { randomize_file_urls: 'yes' },
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(201) },
        { avatar_file: '' },
      ])
        expect(input.safeParse(args).success, JSON.stringify(args)).toBe(false)
    })

    it('refuses a call that changes nothing', async () => {
      const error = await refusal('update_profile', {})
      expect(error.message).toMatch(/Nothing to change/)
      expect(mocks.account).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it.each([
      ['admin', /`vanity_id`: This URL path is reserved/],
      ['API', /`vanity_id`: This URL path is reserved/],
      ['ab', /`vanity_id`: Vanity URL must be at least 3 characters/],
      ['x'.repeat(33), /`vanity_id`: Vanity URL must be at most 32/],
      ['-mira', /`vanity_id`: Vanity URL must start and end/],
      ['mi ra', /`vanity_id`: Vanity URL must start and end/],
    ])(
      'refuses the vanity ID %s as the profile route does, before saving anything',
      async (vanityId, message) => {
        const error = await refusal(
          'update_profile',
          { vanity_id: vanityId, name: 'Mira', theme_mode: 'dark' },
          granted('update_profile', 'theme_mode')
        )
        expect(error.message).toMatch(message)
        expectNothingChanged()
      }
    )

    it.each([
      [{ title: '{{password}}' }, /`embed\.title`: Use only \{\{filename\}\}/],
      [{ site_name: '{{secret}}' }, /`embed\.site_name`: Use only/],
      [{ color: 'red' }, /`embed\.color`: Use a six-digit hex color/],
    ])(
      'refuses the embed %j as the embed route does, before saving anything',
      async (embed, message) => {
        const error = await refusal(
          'update_profile',
          { embed, name: 'Mira' },
          granted('update_profile', 'embed')
        )
        expect(error.message).toMatch(message)
        expectNothingChanged()
      }
    )

    it('takes an embed line as long as the embed route does and no longer', () => {
      const { input } = tool('update_profile')
      const fits = (embed: object) => input.safeParse({ embed }).success
      expect(fits({ site_name: 'x'.repeat(100) })).toBe(true)
      expect(fits({ site_name: 'x'.repeat(101) })).toBe(false)
      expect(fits({ author: 'x'.repeat(101) })).toBe(false)
      expect(fits({ title: 'x'.repeat(500) })).toBe(true)
      expect(fits({ title: 'x'.repeat(501) })).toBe(false)
      expect(fits({ description: 'x'.repeat(501) })).toBe(false)
    })
  })

  describe('effects', () => {
    const base = granted('update_profile')

    it.each<[string, object, Permission]>([
      ['theme_mode', { theme_mode: 'dark' }, 'appearance.personal'],
      ['embed', { embed: { mode: 'rich' } }, 'files.share'],
    ])(
      'refuses %s without the role permission, and saves nothing else of the call',
      async (effect, args, permission) => {
        const error = await refusal(
          'update_profile',
          { ...args, name: 'Mira', avatar_file: 'f-me' },
          base
        )
        expect(error.outcome).toBe('denied')
        expect(error.message).toBe(`Not allowed: ${effect}`)
        expectNothingChanged()
        // The permission alone is what the effect asks for.
        await call(
          'update_profile',
          { ...args, name: 'Mira' },
          {
            scopes: base.scopes,
            permissions: [...base.permissions, permission],
          }
        )
        expect(mocks.saveSettings).toHaveBeenCalledOnce()
      }
    )

    it('gives another permission no say over the theme or the embed', async () => {
      const others = {
        scopes: [...base.scopes, 'files:share', 'files:delete'],
        permissions: [...base.permissions, 'files.delete', 'folders.share'],
      } satisfies Grant
      for (const args of [{ theme_mode: 'dark' }, { embed: { mode: 'rich' } }])
        expect((await refusal('update_profile', args, others)).outcome).toBe(
          'denied'
        )
      expectNothingChanged()
    })

    it('refuses the embed on an instance that uses one embed for every account, and says so', async () => {
      mocks.embedsAllowed.mockResolvedValue(false)
      const error = await refusal(
        'update_profile',
        { embed: { mode: 'rich' }, name: 'Mira', theme_mode: 'dark' },
        granted('update_profile', 'embed', 'theme_mode')
      )
      expect(error.outcome).toBe('denied')
      expect(error.message).toMatch(
        /This instance uses one embed for every account, so `embed` cannot be changed/
      )
      expectNothingChanged()
      // Everything else about the account can still change there.
      const { structured } = await call('update_profile', { name: 'Mira' })
      expect(structured.personal_embeds).toBe(false)
      expect(mocks.saveSettings).toHaveBeenCalledOnce()
    })

    type Saved = [
      AccountRow['defaultFileExpiration'],
      AccountRow['defaultFileExpirationAction'],
    ]
    const DELETES = 'default_expiry_delete'
    const HIDES = 'default_expiry_make_private'
    const OWN_ACTION: Record<string, string> = {
      [DELETES]:
        'that ask to be deleted when they expire would be deleted after the new time',
      [HIDES]:
        'that ask to be made private when they expire would be made private after the new time',
    }

    // A new length reaches uploads that name an action themselves, so it
    // needs what either action needs.
    const BOTH = 'both'

    describe.each<[string, Saved, object, string | null, typeof BOTH?]>([
      [
        'a length while the saved action deletes',
        ['DISABLED', 'DELETE'],
        { default_expiry: 'week' },
        DELETES,
        BOTH,
      ],
      // A new time for files to be deleted is scheduling their deletion.
      [
        'another length while the saved default already deletes',
        ['WEEK', 'DELETE'],
        { default_expiry: 'day' },
        DELETES,
        BOTH,
      ],
      [
        'a length while the saved action makes private',
        ['DISABLED', 'SET_PRIVATE'],
        { default_expiry: 'month' },
        HIDES,
        BOTH,
      ],
      [
        'the delete action while a length is saved',
        ['WEEK', 'SET_PRIVATE'],
        { default_expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the make-private action while a length is saved',
        ['HOUR', 'DELETE'],
        { default_expiry_action: 'make_private' },
        HIDES,
      ],
      [
        'a length and the delete action together',
        ['DISABLED', 'SET_PRIVATE'],
        { default_expiry: 'day', default_expiry_action: 'delete' },
        DELETES,
        BOTH,
      ],
      [
        'a length and the make-private action over a saved delete',
        ['WEEK', 'DELETE'],
        { default_expiry: 'week', default_expiry_action: 'make_private' },
        HIDES,
      ],
      // An action is saved even while the default is off, so it is checked.
      [
        'the delete action while the default is off',
        ['DISABLED', 'SET_PRIVATE'],
        { default_expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the make-private action while the default is off',
        ['DISABLED', 'DELETE'],
        { default_expiry_action: 'make_private' },
        HIDES,
      ],
      [
        'the delete action the account already has, while the default is off',
        ['DISABLED', 'DELETE'],
        { default_expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the default off together with the delete action',
        ['WEEK', 'SET_PRIVATE'],
        { default_expiry: 'never', default_expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the default off together with the make-private action',
        ['WEEK', 'DELETE'],
        { default_expiry: 'never', default_expiry_action: 'make_private' },
        HIDES,
      ],
      [
        'the default off while the saved action deletes',
        ['WEEK', 'DELETE'],
        { default_expiry: 'never' },
        null,
      ],
      [
        'the default off while it is off already',
        ['DISABLED', 'SET_PRIVATE'],
        { default_expiry: 'never' },
        null,
      ],
      [
        'only the name while a default that deletes is saved',
        ['WEEK', 'DELETE'],
        { name: 'Mira' },
        null,
      ],
    ])('a call that sets %s', (_what, [length, action], args, effect, both) => {
      beforeEach(() => {
        row.defaultFileExpiration = length
        row.defaultFileExpirationAction = action
      })

      if (!effect) {
        it('needs neither expiry effect', async () => {
          await call('update_profile', args, base)
          expect(mocks.saveSettings).toHaveBeenCalledOnce()
        })
        return
      }
      const other = effect === DELETES ? HIDES : DELETES
      const needs = TOOL_CATALOG.update_profile.effects[
        effect as typeof DELETES
      ] as ToolNeeds

      it(`needs ${effect}, and changes nothing without it`, async () => {
        const error = await refusal(
          'update_profile',
          { ...args, vanity_id: 'mira' },
          base
        )
        expect(error.outcome).toBe('denied')
        expect(error.message).toContain(`Not allowed: ${effect}`)
        expectNothingChanged()
      })

      it('is refused with the scope but not the role permission, and the other way round', async () => {
        for (const grant of [
          {
            scopes: [...base.scopes, ...needs.scopes],
            permissions: base.permissions,
          },
          {
            scopes: base.scopes,
            permissions: [...base.permissions, ...needs.permissions],
          },
          // What the other expiry action needs is no help.
          granted('update_profile', other),
        ])
          expect(
            (await refusal('update_profile', args, grant)).message
          ).toContain(`Not allowed: ${effect}`)
        expectNothingChanged()
      })

      it(`is saved with the scope and the role permission${both ? ' of both' : ''}`, async () => {
        await call(
          'update_profile',
          args,
          granted('update_profile', effect, ...(both ? [other] : []))
        )
        expect(mocks.saveSettings).toHaveBeenCalledOnce()
      })

      if (both)
        it(`needs ${other} too, for uploads that name that action themselves`, async () => {
          const error = await refusal(
            'update_profile',
            args,
            granted('update_profile', effect)
          )
          expect(error.outcome).toBe('denied')
          expect(error.message).toContain(OWN_ACTION[other])
          expect(error.message).toContain(`Not allowed: ${other}`)
          expectNothingChanged()
        })
    })

    describe('a connection that may change sharing and may not delete', () => {
      const sharing = granted('update_profile', HIDES)
      const setsAction = { default_expiry_action: 'delete' }
      const setsLength = { default_expiry: 'hour' }
      const LENGTH_REFUSED = `Uploads that name no profile or \`none\` and uploads with the profile "Private" ${OWN_ACTION[DELETES]}. Not allowed: ${DELETES}. Nothing was changed.`

      beforeEach(() => {
        row.defaultFileExpiration = 'DISABLED'
        row.defaultFileExpirationAction = 'SET_PRIVATE'
      })

      it('can set neither the delete action nor a length, in either order', async () => {
        for (const calls of [
          [setsAction, setsLength],
          [setsLength, setsAction],
        ])
          for (const args of calls) {
            const error = await refusal('update_profile', args, sharing)
            expect(error.message).toBe(
              args === setsAction ? `Not allowed: ${DELETES}` : LENGTH_REFUSED
            )
          }
        expectNothingChanged()
        expect(row).toMatchObject({
          defaultFileExpiration: 'DISABLED',
          defaultFileExpirationAction: 'SET_PRIVATE',
        })
      })

      it('is refused the length because an upload can name the delete action itself', async () => {
        // The saved action makes private, which this connection may ask
        // for. An upload that names `delete` and no expiry takes the saved
        // length, and would be deleted after the hour.
        const error = await refusal('update_profile', setsLength, sharing)
        expect(error.message).toBe(LENGTH_REFUSED)
        expect(error.outcome).toBe('denied')
      })

      it('is refused both when they arrive together', async () => {
        const results = await Promise.allSettled([
          call('update_profile', setsAction, sharing),
          call('update_profile', setsLength, sharing),
        ])
        expect(results.map(({ status }) => status)).toEqual([
          'rejected',
          'rejected',
        ])
        expect(row.defaultFileExpirationAction).toBe('SET_PRIVATE')
        expectNothingChanged()
      })

      it('could not ask for that default in one call either', async () => {
        const error = await refusal(
          'update_profile',
          { ...setsAction, ...setsLength },
          sharing
        )
        expect(error.message).toBe(`Not allowed: ${DELETES}`)
        expectNothingChanged()
      })

      it('may still turn a default off, which needs nothing', async () => {
        row.defaultFileExpiration = 'WEEK'
        await call('update_profile', { default_expiry: 'never' }, sharing)
        expect(row.defaultFileExpiration).toBe('DISABLED')
      })
    })
  })

  describe('the avatar', () => {
    const base = granted('update_profile')
    /** Reading file contents and changing sharing, on top of the row. */
    const SHARED = granted(
      'update_profile',
      'avatar_file',
      'avatar_private_file'
    )
    const choose = (args: object = {}, grant: Grant = AVATAR) =>
      call('update_profile', { avatar_file: 'f-me', ...args }, grant)
    const refused = (args: object = {}, grant: Grant = AVATAR) =>
      refusal('update_profile', { avatar_file: 'f-me', ...args }, grant)

    describe('what choosing one needs', () => {
      it('is refused to a connection that may not read file contents, before any file is looked up', async () => {
        const error = await refused({ name: 'Mira' }, base)
        expect(error.outcome).toBe('denied')
        expect(error.message).toBe('Not allowed: avatar_file')
        const needs: ToolNeeds = TOOL_CATALOG.update_profile.effects.avatar_file
        for (const grant of [
          // The scope without the role permission, and the other way round.
          {
            scopes: [...base.scopes, ...needs.scopes],
            permissions: base.permissions,
          },
          {
            scopes: base.scopes,
            permissions: [...base.permissions, ...needs.permissions],
          },
          // Changing sharing is not reading.
          granted('update_profile', 'avatar_private_file'),
        ])
          expect((await refused({}, grant)).message).toBe(
            'Not allowed: avatar_file'
          )
        expect(mocks.findFile).not.toHaveBeenCalled()
        expect(mocks.stream).not.toHaveBeenCalled()
        expectNothingChanged()
      })

      it('takes a public image without a password with that alone', async () => {
        await choose()
        expect(mocks.uploadAvatar).toHaveBeenCalledExactlyOnceWith(
          'owner',
          PNG,
          expect.any(Function)
        )
      })

      it.each([
        ['a private image', { visibility: 'PRIVATE' }, 'private'],
        [
          'a public image with a password',
          { password: '$2b$10$stored-hash' },
          'protected by a password',
        ],
        [
          'a private image with a password',
          { visibility: 'PRIVATE', password: '$2b$10$stored-hash' },
          'private',
        ],
      ])(
        'refuses %s without Change sharing, before a byte is read, and takes it with',
        async (_what, hidden, why) => {
          mocks.findFile.mockResolvedValue({ ...image, ...hidden })
          const error = await refused({ name: 'Mira' })
          expect(error.outcome).toBe('denied')
          expect(error.message).toBe(
            `"me.png" is ${why}, and an avatar is visible to anyone, so making it the avatar needs Change sharing. An image that is public and has no password does not. Not allowed: avatar_private_file`
          )
          // The hash it looked at is in no answer.
          expect(error.message).not.toContain('stored-hash')
          const needs: ToolNeeds =
            TOOL_CATALOG.update_profile.effects.avatar_private_file
          for (const grant of [
            {
              scopes: [...AVATAR.scopes, ...needs.scopes],
              permissions: AVATAR.permissions,
            },
            {
              scopes: AVATAR.scopes,
              permissions: [...AVATAR.permissions, ...needs.permissions],
            },
          ])
            expect((await refused({}, grant)).message).toMatch(
              /needs Change sharing\..* Not allowed: avatar_private_file$/
            )
          expect(mocks.stream).not.toHaveBeenCalled()
          expectNothingChanged()

          await choose({}, SHARED)
          expect(mocks.uploadAvatar).toHaveBeenCalledExactlyOnceWith(
            'owner',
            PNG,
            expect.any(Function)
          )
        }
      )

      it('needs neither to remove the avatar', async () => {
        row.image = '/api/avatars/owner-old.jpg'
        const { structured } = await call(
          'update_profile',
          { avatar_file: null },
          base
        )
        expect(mocks.removeAvatar).toHaveBeenCalledExactlyOnceWith(
          'owner',
          expect.any(Function)
        )
        expect(mocks.findFile).not.toHaveBeenCalled()
        expect(structured).not.toHaveProperty('avatar_url')
      })

      it('says that a file can never be an avatar before it asks for Change sharing', async () => {
        mocks.findFile.mockResolvedValue({
          ...image,
          visibility: 'PRIVATE',
          mimeType: 'video/mp4',
          name: 'clip.mp4',
        })
        expect((await refused()).message).toMatch(
          /"clip\.mp4" is video\/mp4, which cannot be an avatar/
        )
        mocks.findFile.mockResolvedValue({
          ...image,
          visibility: 'PRIVATE',
          size: 3,
        })
        expect((await refused()).message).toMatch(/too large for an avatar/)
        expect(mocks.stream).not.toHaveBeenCalled()
        expectNothingChanged()
      })
    })

    it("refuses another account's file exactly like one that does not exist", async () => {
      mocks.findFile.mockResolvedValue({ ...image, userId: 'stranger' })
      // Whatever the connection may do with its own files.
      const theirs = await refused({ name: 'Mira' }, SHARED)
      mocks.findFile.mockResolvedValue(null)
      const missing = await refused()
      expect(theirs.message).toBe(missing.message)
      expect(theirs.message).toMatch(/No file of this account matches "f-me"/)
      expect(mocks.stream).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it.each([
      ['text/plain', 'notes.txt'],
      ['image/svg+xml', 'logo.svg'],
      ['video/mp4', 'clip.mp4'],
      ['application/pdf', 'doc.pdf'],
    ])('refuses a %s file without reading it', async (mimeType, name) => {
      mocks.findFile.mockResolvedValue({ ...image, mimeType, name })
      const error = await refused({ name: 'Mira' })
      expect(error.message).toBe(
        `"${name}" is ${mimeType}, which cannot be an avatar. An avatar is a PNG, JPEG, GIF or WebP image of at most 2 MB.`
      )
      expect(mocks.stream).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it('refuses an image larger than an avatar may be without reading it', async () => {
      mocks.findFile.mockResolvedValue({ ...image, size: 2 + 1 / MB })
      const error = await refused({ name: 'Mira' })
      expect(error.message).toMatch(
        /"me\.png" is 2097153 bytes, which is too large for an avatar\. An avatar is .* at most 2 MB\./
      )
      expect(mocks.stream).not.toHaveBeenCalled()
      expectNothingChanged()
      // Exactly the limit is an avatar.
      mocks.findFile.mockResolvedValue({ ...image, size: 2 })
      await choose()
      expect(mocks.uploadAvatar).toHaveBeenCalledOnce()
    })

    it('stops reading a file that is larger in storage than its record says', async () => {
      const chunk = Buffer.alloc(MB, 1)
      let chunks = 0
      mocks.stream.mockImplementation(async () =>
        Readable.from(
          (function* () {
            for (;;) {
              chunks++
              yield chunk
            }
          })()
        )
      )
      const error = await refused({ name: 'Mira' })
      expect(error.message).toMatch(
        /"me\.png" is over 2097152 bytes in storage, which is too large for an avatar/
      )
      // Three megabytes pass the limit; the endless stream is not drained.
      expect(chunks).toBeLessThan(8)
      expectNothingChanged()
    })

    it.each([
      ['text under an image type', Buffer.from('<svg onload=alert(1)>')],
      ['an empty file', Buffer.alloc(0)],
    ])('refuses %s', async (_what, bytes) => {
      mocks.findFile.mockResolvedValue({
        ...image,
        size: Math.max(bytes.length, 1) / MB,
      })
      mocks.stream.mockImplementation(async () => Readable.from([bytes]))
      const error = await refused({ name: 'Mira' })
      expect(error.message).toMatch(
        /"me\.png" is stored as image\/png, but its contents are not such an image/
      )
      expectNothingChanged()
    })

    it('refuses a file recorded as empty without reading it', async () => {
      mocks.findFile.mockResolvedValue({ ...image, size: 0 })
      const error = await refused()
      expect(error.message).toMatch(/its contents are not such an image/)
      expect(mocks.stream).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it.each([
      ['JPEG', 'image/jpeg', Buffer.from('ffd8ffe000104a464946', 'hex')],
      ['GIF', 'image/gif', Buffer.from('GIF89a-and-more')],
      ['WebP', 'image/webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ')],
      // The record says PNG; the bytes are another format an avatar may be.
      ['a JPEG recorded as PNG', 'image/png', Buffer.from('ffd8ffe1', 'hex')],
    ])('takes %s', async (_what, mimeType, bytes) => {
      mocks.findFile.mockResolvedValue({
        ...image,
        mimeType,
        size: bytes.length / MB,
      })
      mocks.stream.mockImplementation(async () => Readable.from([bytes]))
      await choose()
      expect(mocks.uploadAvatar).toHaveBeenCalledExactlyOnceWith(
        'owner',
        bytes,
        expect.any(Function)
      )
    })

    it('finds the image by its share URL or path among this account only', async () => {
      mocks.findFile.mockResolvedValue(image)
      await choose({ avatar_file: 'https://flare.test/alex/me.png' })
      expect(mocks.findFile).toHaveBeenCalledExactlyOnceWith(
        { userUrlId: 'alex', filename: 'me.png' },
        expect.anything()
      )
      expect(mocks.uploadAvatar).toHaveBeenCalledOnce()
    })
  })

  describe('a token bound to an upload profile', () => {
    beforeEach(() => {
      boundTo = 'p-screens'
    })
    const everyEffect = granted(
      'update_profile',
      'theme_mode',
      'embed',
      'avatar_file',
      'default_expiry_delete',
      'default_expiry_make_private'
    )

    it.each<[object, string]>([
      [
        { randomize_file_urls: true },
        '`randomize_file_urls`, which decides how uploads behave. Leave it out',
      ],
      [
        { default_expiry: 'never' },
        '`default_expiry`, which decides how uploads behave. Leave it out',
      ],
      [
        { default_expiry_action: 'make_private' },
        '`default_expiry_action`, which decides how uploads behave. Leave it out',
      ],
      [
        {
          default_expiry_action: 'delete',
          default_expiry: 'week',
          randomize_file_urls: false,
        },
        '`randomize_file_urls`, `default_expiry`, `default_expiry_action`, which decide how uploads behave. Leave them out',
      ],
    ])(
      'cannot change %j, and nothing else of the call is saved',
      async (args, part) => {
        const error = await refusal(
          'update_profile',
          { ...args, name: 'Mira', theme_mode: 'dark', avatar_file: null },
          everyEffect
        )
        expect(error.outcome).toBe('denied')
        expect(error.message).toBe(
          `This token is bound to the upload profile "Screenshots", so it cannot change ${part}, or use a connection that is not bound to a profile.`
        )
        expect(mocks.account).not.toHaveBeenCalled()
        expectNothingChanged()
      }
    )

    it('still changes everything that does not decide how uploads behave', async () => {
      await call(
        'update_profile',
        {
          name: 'Mira',
          vanity_id: 'mira',
          theme_mode: 'dark',
          embed: { mode: 'rich' },
          avatar_file: 'f-me',
        },
        everyEffect
      )
      expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
        name: 'Mira',
        vanityId: 'mira',
      })
      expect(mocks.uploadAvatar).toHaveBeenCalledOnce()
      expect(mocks.saveTheme).toHaveBeenCalledOnce()
      expect(mocks.saveEmbed).toHaveBeenCalledOnce()
      // Nothing it asked for depends on the binding, so it is not read.
      expect(mocks.profileNow).not.toHaveBeenCalled()
    })

    it('names a bound profile that no longer exists by its ID', async () => {
      boundTo = 'p-deleted'
      const error = await refusal('update_profile', {
        randomize_file_urls: true,
      })
      expect(error.message).toBe(
        'This token is bound to the upload profile p-deleted, so it cannot change `randomize_file_urls`, which decides how uploads behave. Leave it out, or use a connection that is not bound to a profile.'
      )
      expect(mocks.profileNow).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'p-deleted', userId: 'owner' },
        select: { name: true },
      })
      expectNothingChanged()
    })

    it('is told about the binding, not about a scope that would not help', async () => {
      const error = await refusal('update_profile', {
        default_expiry_action: 'delete',
      })
      expect(error.message).toMatch(
        /^This token is bound to the upload profile "Screenshots", so it cannot change `default_expiry_action`/
      )
    })

    it('does not concern a token that is not bound', async () => {
      boundTo = null
      await call(
        'update_profile',
        { randomize_file_urls: true, default_expiry: 'never' },
        everyEffect
      )
      expect(mocks.saveSettings.mock.calls[0][1]).toEqual({
        randomizeFileUrls: true,
        defaultFileExpiration: 'DISABLED',
      })
      expect(mocks.profileNow).not.toHaveBeenCalled()
    })
  })

  describe('a failure part of the way', () => {
    const everything = {
      name: 'Mira',
      vanity_id: 'mira',
      avatar_file: 'f-me',
      theme_mode: 'dark',
      embed: { mode: 'rich' },
    }
    const grant = granted(
      'update_profile',
      'theme_mode',
      'embed',
      'avatar_file'
    )

    it('changes nothing when the first save is refused, and says so', async () => {
      mocks.saveSettings.mockRejectedValue(
        new HttpError(400, 'This vanity URL is already taken')
      )
      const error = await refusal('update_profile', everything, grant)
      expect(error.message).toBe(
        'This vanity URL is already taken. Nothing was changed.'
      )
      expect(error.outcome).toBe('failure')
      for (const later of writes.filter((name) => name !== 'saveSettings'))
        expect(mocks[later], later).not.toHaveBeenCalled()
    })

    it('says what was saved and what was not when a later save fails', async () => {
      mocks.uploadAvatar.mockRejectedValue(
        new HttpError(413, 'Storage quota exceeded')
      )
      const error = await refusal('update_profile', everything, grant)
      expect(error.message).toBe(
        'Storage quota exceeded. Saved before that: `name`, `vanity_id`. Not saved: `avatar_file`, `theme_mode`, `embed`. Call again with only what was not saved.'
      )
      expect(mocks.saveSettings).toHaveBeenCalledOnce()
      expect(mocks.saveTheme).not.toHaveBeenCalled()
      expect(mocks.saveEmbed).not.toHaveBeenCalled()
    })

    it('records a refusal by role as denied', async () => {
      mocks.saveTheme.mockRejectedValue(
        new HttpError(403, 'You no longer have permission for this action')
      )
      const error = await refusal('update_profile', everything, grant)
      expect(error.outcome).toBe('denied')
      expect(error.message).toBe(
        'You no longer have permission for this action. Saved before that: `name`, `vanity_id`, `avatar_file`. Not saved: `theme_mode`, `embed`. Call again with only what was not saved.'
      )
      expect(mocks.saveEmbed).not.toHaveBeenCalled()
    })

    it('keeps what an unexpected failure says out of the answer', async () => {
      mocks.saveEmbed.mockRejectedValue(
        new Error('connect ECONNREFUSED db:5432')
      )
      const error = await refusal('update_profile', everything, grant)
      expect(error.message).toBe(
        'Flare could not save `embed`. Saved before that: `name`, `vanity_id`, `avatar_file`, `theme_mode`. Not saved: `embed`. Call again with only what was not saved.'
      )
      expect(loggers.api.error).toHaveBeenCalledOnce()
    })
  })

  describe('what the model is told', () => {
    const { description, input } = tool('update_profile')
    const told = (argument: string) => input.shape[argument].description ?? ''

    it('says in about a hundred words what the tool changes and what cannot be undone or hidden', () => {
      expect(description.split(/\s+/).length).toBeLessThanOrEqual(110)
      for (const sentence of [
        "Change this account's own settings: display name, vanity ID, upload defaults, theme, link embed and avatar.",
        'Arguments left out stay as they are.',
        'Changing or removing the vanity ID breaks links that use the old one, a default expiry deletes or makes private every later upload that sets none, and the avatar is public.',
        "The email address, the password, passkeys and everything else about signing in cannot be changed here: the owner does that on Flare's Profile page.",
        'Everything is checked before anything is saved; if a part still fails to save, the error says what was saved and what was not.',
        'get_account reads the current values.',
      ])
        expect(description).toContain(sentence)
      expect(description).not.toMatch(/[\u2013\u2014]/)
    })

    it('keeps what one argument needs with that argument', () => {
      expect(told('vanity_id')).toMatch(
        /second address for the account's share links, \/vanity_id\/filename: 3 to 32 letters, digits and inner hyphens, not used by another account\. null removes it/
      )
      // A change is judged by what it does to every way of uploading.
      expect(told('default_expiry')).toContain(
        '`never` turns the default off and needs nothing more.'
      )
      expect(told('default_expiry')).toContain(
        'A length that is new for uploads with any profile or none, a profile taking what it leaves out from the account, needs a connection that may delete files and may change sharing: an upload can name either action itself and then takes this length'
      )
      // The action is judged whether or not a length is set.
      expect(told('default_expiry_action')).toContain(
        '`delete` needs a connection that may delete files and `make_private` one that may change sharing, also while the default is off.'
      )
      for (const argument of [
        'randomize_file_urls',
        'default_expiry',
        'default_expiry_action',
      ])
        expect(told(argument), argument).toMatch(
          /A token bound to an upload profile cannot set this$/
        )
      for (const placeholder of [
        '{{filename}}',
        '{{size}}',
        '{{type}}',
        '{{uploader}}',
        '{{date}}',
        '{{views}}',
        '{{instanceName}}',
      ])
        expect(told('embed')).toContain(placeholder)
      expect(told('embed')).toContain(
        'Refused on an instance that uses one embed for every account'
      )
      expect(told('embed')).toContain('an empty string clears a line')
      expect(told('avatar_file')).toContain(
        'An avatar is a PNG, JPEG, GIF or WebP image of at most 2 MB.'
      )
      expect(told('avatar_file')).toContain(
        'The avatar is public, so choosing one needs a connection that may read file contents, and for a file that is private or has a password one that may change sharing too'
      )
      expect(told('avatar_file')).toContain('null removes the avatar')
      // Every argument says something, in words without an em dash.
      for (const argument of Object.keys(input.shape)) {
        expect(told(argument).length, argument).toBeGreaterThan(10)
        expect(told(argument)).not.toMatch(/[\u2013\u2014]/)
      }
    })
  })
})

describe('save_upload_profile', () => {
  const DELETES = 'expiry_delete'
  const HIDES = 'expiry_make_private'
  const base = granted('save_upload_profile')
  const screens = {
    id: 'p-screens',
    name: 'Screenshots',
    visibility: 'public',
    expiry: 'week',
    expiry_action: 'make_private',
    randomize_file_urls: true,
    share_style: 'minimal',
    tags: ['Work'],
  }

  describe('creating', () => {
    it('creates a profile from the settings, as the profile route would be sent them', async () => {
      const { structured, audit } = await call(
        'save_upload_profile',
        {
          name: '  Client work ',
          visibility: 'private',
          expiry: 'day',
          expiry_action: 'delete',
          randomize_file_urls: true,
          share_style: 'delivery',
          tags: ['work', 't-old', 'Work'],
        },
        // A length of its own needs what either action needs.
        granted('save_upload_profile', DELETES, HIDES)
      )
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
        name: 'Client work',
        options: {
          visibility: 'PRIVATE',
          expiration: 'DAY',
          expiryAction: 'DELETE',
          randomizeFileUrls: true,
          shareStyle: 'delivery',
          // Each tag once, by ID, however the call named it.
          tagIds: ['t-work', 't-old'],
        },
      })
      expect(structured).toEqual({
        created: true,
        profile: {
          id: 'p-new',
          name: 'Client work',
          revision: '2026-11-22T08:00:00.000Z',
          visibility: 'private',
          expiry: 'day',
          expiry_action: 'delete',
          randomize_file_urls: true,
          share_style: 'delivery',
          tags: ['Work', 'Old'],
        },
      })
      expect(audit).toMatchObject({
        targetType: 'upload_profile',
        targetId: 'p-new',
        targetName: 'Client work',
      })
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.setDefault).not.toHaveBeenCalled()
    })

    it('creates a profile that fixes nothing from a name alone', async () => {
      const { structured } = await call('save_upload_profile', {
        name: 'Plain',
        visibility: null,
        tags: [],
      })
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
        name: 'Plain',
        options: {},
      })
      expect(structured).toEqual({
        created: true,
        profile: {
          id: 'p-new',
          name: 'Plain',
          revision: '2026-11-22T08:00:00.000Z',
        },
      })
      expect(mocks.tags).not.toHaveBeenCalled()
    })

    it.each([
      ['never', 'DISABLED'],
      ['hour', 'HOUR'],
      ['day', 'DAY'],
      ['week', 'WEEK'],
      ['month', 'MONTH'],
    ])('saves an expiry of %s as %s', async (word, stored) => {
      // The action is the account default, which deletes.
      const { structured } = await call(
        'save_upload_profile',
        { name: 'Timed', expiry: word },
        granted('save_upload_profile', DELETES, HIDES)
      )
      expect(mocks.create.mock.calls[0][1].options).toEqual({
        expiration: stored,
      })
      expect(structured.profile).toMatchObject({ expiry: word })
    })

    it('needs a name, and takes no revision', async () => {
      expect(
        (await refusal('save_upload_profile', { visibility: 'private' }))
          .message
      ).toMatch(/Give the new profile a `name`, or say which `profile`/)
      expect(
        (
          await refusal('save_upload_profile', {
            name: 'New',
            revision: '2026-11-20T10:00:00.000Z',
          })
        ).message
      ).toMatch(/`revision` belongs to a change/)
      expectNothingChanged()
    })

    it('says what to do about a name another profile has', async () => {
      mocks.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      const error = await refusal('save_upload_profile', { name: 'Private' })
      expect(error.message).toBe(
        'A profile with this name already exists. Choose another `name`, or pass that profile as `profile` to change it.'
      )
    })

    it('makes the new profile the default when asked', async () => {
      const { structured } = await call('save_upload_profile', {
        name: 'Main',
        make_default: true,
      })
      expect(mocks.setDefault).toHaveBeenCalledExactlyOnceWith('owner', 'p-new')
      expect(structured.profile).toMatchObject({ id: 'p-new', default: true })
      // `false` on a profile that is not the default has nothing to undo.
      mocks.setDefault.mockClear()
      await call('save_upload_profile', { name: 'Side', make_default: false })
      expect(mocks.setDefault).not.toHaveBeenCalled()
    })

    it('creates nothing when making it the default fails, as both are one save', async () => {
      mocks.setDefault.mockRejectedValue(
        new HttpError(404, 'Profile not found.')
      )
      await expect(
        call('save_upload_profile', { name: 'Main', make_default: true })
      ).rejects.toThrow('Profile not found.')
      expectNothingChanged()
      expect(profiles.map(({ id }) => id)).toEqual(['p-private', 'p-screens'])
    })

    it('creates nothing when the new profile as the default is refused', async () => {
      row.defaultFileExpiration = 'WEEK'
      const error = await refusal(
        'save_upload_profile',
        { name: 'Main', expiry: 'day', make_default: true },
        granted('save_upload_profile', HIDES)
      )
      expect(error.message).toBe(
        'Uploads that name no profile and uploads with the profile "Main" would be deleted when they expire. Not allowed: expiry_delete'
      )
      expectNothingChanged()
      expect(row.defaultUploadProfileId).toBeNull()
    })

    it('refuses a tag the account does not have, and more than twenty', async () => {
      const error = await refusal('save_upload_profile', {
        name: 'Tagged',
        tags: ['Work', 'Ghost'],
      })
      expect(error.message).toMatch(/No tag matches "Ghost"/)
      const { input } = tool('save_upload_profile')
      const many = (count: number) =>
        input.safeParse({
          name: 'Tagged',
          tags: Array.from({ length: count }, (_, index) => `tag-${index}`),
        }).success
      expect(many(20)).toBe(true)
      expect(many(21)).toBe(false)
      expectNothingChanged()
    })
  })

  describe('changing', () => {
    it.each([
      ['its ID', 'p-screens'],
      ['its name', 'Screenshots'],
      ['its name in another case', ' screenshots '],
    ])(
      'changes the profile named by %s, leaving the rest as saved',
      async (_how, value) => {
        const { structured, audit } = await call('save_upload_profile', {
          profile: value,
          visibility: 'private',
        })
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
          'owner',
          'p-screens',
          // Without a revision, the one the profile was just read at.
          '2026-11-20T11:30:00.000Z',
          {
            name: 'Screenshots',
            options: {
              visibility: 'PRIVATE',
              expiration: 'WEEK',
              expiryAction: 'SET_PRIVATE',
              randomizeFileUrls: true,
              shareStyle: 'minimal',
              tagIds: ['t-work'],
            },
          }
        )
        expect(structured).toEqual({
          profile: {
            ...screens,
            visibility: 'private',
            revision: '2026-11-22T08:30:00.000Z',
          },
        })
        expect(audit).toMatchObject({
          targetType: 'upload_profile',
          targetId: 'p-screens',
        })
        expect(mocks.create).not.toHaveBeenCalled()
      }
    )

    it('renames, and replaces every setting the call names', async () => {
      await call(
        'save_upload_profile',
        {
          profile: 'Private',
          name: 'Hidden',
          expiry: 'month',
          expiry_action: 'delete',
          randomize_file_urls: false,
          share_style: 'framed',
          tags: ['Old'],
        },
        granted('save_upload_profile', DELETES, HIDES)
      )
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'p-private',
        '2026-11-20T10:00:00.000Z',
        {
          name: 'Hidden',
          options: {
            visibility: 'PRIVATE',
            expiration: 'MONTH',
            expiryAction: 'DELETE',
            randomizeFileUrls: false,
            shareStyle: 'framed',
            tagIds: ['t-old'],
          },
        }
      )
    })

    it('takes a setting out of the profile with null, and its tags with an empty list', async () => {
      const { structured } = await call(
        'save_upload_profile',
        {
          profile: 'Screenshots',
          visibility: null,
          expiry: null,
          expiry_action: null,
          randomize_file_urls: null,
          share_style: null,
          tags: [],
        },
        // Without its own action the profile takes the account's, which
        // deletes, for uploads that bring an expiry.
        granted('save_upload_profile', DELETES)
      )
      expect(mocks.update.mock.calls[0][3]).toEqual({
        name: 'Screenshots',
        options: {},
      })
      expect(structured.profile).toEqual({
        id: 'p-screens',
        name: 'Screenshots',
        revision: '2026-11-22T08:30:00.000Z',
      })
      mocks.update.mockClear()
      await call('save_upload_profile', { profile: 'Screenshots', tags: null })
      expect(mocks.update.mock.calls[0][3].options).not.toHaveProperty('tagIds')
    })

    it('saves against the revision the call gives', async () => {
      await call('save_upload_profile', {
        profile: 'Screenshots',
        share_style: 'framed',
        revision: '2026-11-20T11:30:00.000Z',
      })
      expect(mocks.update.mock.calls[0][2]).toBe('2026-11-20T11:30:00.000Z')
      // An older one is refused under the lock, before anything is saved.
      mocks.update.mockClear()
      mocks.profileNow.mockResolvedValue({
        updatedAt: new Date('2026-11-20T11:30:00.000Z'),
      })
      const error = await refusal('save_upload_profile', {
        profile: 'Screenshots',
        share_style: 'framed',
        revision: '2026-11-19T08:00:00.000Z',
      })
      expect(mocks.update).not.toHaveBeenCalled()
      expect(error.message).toBe(
        'Nothing was saved: the upload profile "Screenshots" changed after revision 2026-11-19T08:00:00.000Z. It is now at revision 2026-11-20T11:30:00.000Z. Call get_account to see its settings as they are, then call again with that revision, or without `revision` to change the profile as it now stands.'
      )
      expect(mocks.profileNow).toHaveBeenCalledWith({
        where: { id: 'p-screens', userId: 'owner' },
        select: { updatedAt: true },
      })
      expect(mocks.setDefault).not.toHaveBeenCalled()
    })

    it('says so when the profile changed, or went, while the call ran', async () => {
      mocks.update.mockRejectedValue(
        new HttpError(
          409,
          'Profile changed or was removed. Reload it before saving.'
        )
      )
      mocks.profileNow.mockResolvedValue({
        updatedAt: new Date('2026-11-22T07:00:00.000Z'),
      })
      const args = { profile: 'Screenshots', share_style: 'framed' }
      expect((await refusal('save_upload_profile', args)).message).toBe(
        'Nothing was saved: the upload profile "Screenshots" changed while this call ran. Call again.'
      )
      mocks.profileNow.mockResolvedValue(null)
      expect((await refusal('save_upload_profile', args)).message).toMatch(
        /Nothing was saved: the upload profile "Screenshots" was deleted in the meantime/
      )
    })

    it.each(['yesterday', '2026-11-20', '2026-11-20T11:30:00+01:00', ''])(
      'refuses the revision %j, which the route would refuse too',
      async (revision) => {
        const error = await refusal('save_upload_profile', {
          profile: 'Screenshots',
          share_style: 'framed',
          revision,
        })
        expect(error.message).toMatch(
          /`revision` must be the value last answered/
        )
        expectNothingChanged()
      }
    )

    it('saves nothing, and keeps the revision, when the profile already is as asked', async () => {
      const asked = {
        profile: 'Screenshots',
        name: 'Screenshots',
        visibility: 'public',
        tags: ['Work'],
      }
      for (const revision of [undefined, '2026-11-20T11:30:00.000Z']) {
        const { structured } = await call('save_upload_profile', {
          ...asked,
          revision,
        })
        expect(structured).toEqual({
          profile: { ...screens, revision: '2026-11-20T11:30:00.000Z' },
        })
      }
      expectNothingChanged()
      // A revision the profile has left is refused, change or no change.
      mocks.profileNow.mockResolvedValue({
        updatedAt: new Date('2026-11-20T11:30:00.000Z'),
      })
      expect(
        (
          await refusal('save_upload_profile', {
            ...asked,
            revision: '2026-11-01T00:00:00.000Z',
          })
        ).message
      ).toMatch(
        /^Nothing was saved: the upload profile "Screenshots" changed after revision 2026-11-01T00:00:00.000Z\./
      )
    })

    it('refuses a call that names a profile and nothing to change', async () => {
      const error = await refusal('save_upload_profile', {
        profile: 'Screenshots',
      })
      expect(error.message).toMatch(/Nothing to change/)
      expectNothingChanged()
    })

    it('says what to do about a new name another profile has', async () => {
      mocks.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      const error = await refusal('save_upload_profile', {
        profile: 'Screenshots',
        name: 'Private',
      })
      expect(error.message).toBe(
        'A profile with this name already exists. Choose another `name`.'
      )
    })

    it('makes a profile the default without saving it again', async () => {
      const { structured } = await call('save_upload_profile', {
        profile: 'Private',
        make_default: true,
      })
      expect(mocks.setDefault).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'p-private'
      )
      expect(mocks.update).not.toHaveBeenCalled()
      expect(structured.profile).toEqual({
        id: 'p-private',
        name: 'Private',
        default: true,
        revision: '2026-11-20T10:00:00.000Z',
        visibility: 'private',
      })
    })

    it('leaves the default alone when it already is as asked', async () => {
      row.defaultUploadProfileId = 'p-private'
      const kept = await call('save_upload_profile', {
        profile: 'Private',
        make_default: true,
      })
      expect(kept.structured.profile).toMatchObject({ default: true })
      const other = await call('save_upload_profile', {
        profile: 'Screenshots',
        make_default: false,
      })
      expect(other.structured.profile).not.toHaveProperty('default')
      // Another profile's `false` never clears the default.
      expect(mocks.setDefault).not.toHaveBeenCalledWith('owner', null)
      expect(row.defaultUploadProfileId).toBe('p-private')
    })

    it('refuses to make a profile the default at a revision it has left', async () => {
      // The agent read it at 11:30; the owner has since saved it at noon.
      profiles[1] = saved(
        'p-screens',
        'Screenshots',
        { expiration: 'HOUR', expiryAction: 'DELETE' },
        '12:00:00'
      )
      mocks.profileNow.mockResolvedValue({
        updatedAt: new Date('2026-11-20T12:00:00.000Z'),
      })
      const everything = granted('save_upload_profile', DELETES, HIDES)
      const error = await refusal(
        'save_upload_profile',
        {
          profile: 'Screenshots',
          revision: '2026-11-20T11:30:00.000Z',
          make_default: true,
        },
        everything
      )
      expect(error.message).toBe(
        'Nothing was saved: the upload profile "Screenshots" changed after revision 2026-11-20T11:30:00.000Z. It is now at revision 2026-11-20T12:00:00.000Z. Call get_account to see its settings as they are, then call again with that revision, or without `revision` to change the profile as it now stands.'
      )
      expectNothingChanged()
      expect(row.defaultUploadProfileId).toBeNull()
      // At the revision it has now, it becomes the default.
      await call(
        'save_upload_profile',
        {
          profile: 'Screenshots',
          revision: '2026-11-20T12:00:00.000Z',
          make_default: true,
        },
        everything
      )
      expect(row.defaultUploadProfileId).toBe('p-screens')
    })

    it('stops a profile being the default, which leaves the account with none', async () => {
      // A public default, so its uploads stay public without it.
      row.defaultUploadProfileId = 'p-screens'
      const { structured } = await call(
        'save_upload_profile',
        { profile: 'Screenshots', make_default: false },
        // Uploads that name no profile take the account's action again,
        // which deletes, where the profile made private.
        granted('save_upload_profile', DELETES)
      )
      expect(mocks.setDefault).toHaveBeenCalledExactlyOnceWith('owner', null)
      expect(structured.profile).not.toHaveProperty('default')
    })

    it('saves the settings first, then the default', async () => {
      await call('save_upload_profile', {
        profile: 'Private',
        share_style: 'minimal',
        make_default: true,
      })
      expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setDefault.mock.invocationCallOrder[0]
      )
      // A stale edit never reaches the default.
      mocks.setDefault.mockClear()
      mocks.update.mockRejectedValue(new HttpError(409, 'Profile changed'))
      mocks.profileNow.mockResolvedValue(null)
      await refusal('save_upload_profile', {
        profile: 'Private',
        share_style: 'framed',
        make_default: true,
      })
      expect(mocks.setDefault).not.toHaveBeenCalled()
    })

    it('matches nothing, or several, and says which', async () => {
      expect(
        (
          await refusal('save_upload_profile', {
            profile: 'Ghost',
            visibility: 'private',
          })
        ).message
      ).toBe(
        'No upload profile matches "Ghost". Call get_account to see the upload profiles.'
      )
      profiles = [saved('p-a', 'Work'), saved('p-b', 'WORK')]
      expect(
        (
          await refusal('save_upload_profile', {
            profile: 'work',
            visibility: 'private',
          })
        ).message
      ).toBe(
        'Several upload profiles match "work": Work, WORK. Use the exact name or the profile ID.'
      )
      // The exact name is one profile.
      await call('save_upload_profile', {
        profile: 'WORK',
        share_style: 'framed',
      })
      expect(mocks.update.mock.calls[0][1]).toBe('p-b')
      expect(mocks.profiles).toHaveBeenCalledWith({
        where: { userId: 'owner' },
        orderBy: { name: 'asc' },
      })
    })
  })

  describe('the expiry it sets', () => {
    type Default = [
      AccountRow['defaultFileExpiration'],
      AccountRow['defaultFileExpirationAction'],
    ]
    const OFF: Default = ['DISABLED', 'DELETE']

    beforeEach(() => {
      // A profile that already deletes its uploads after a day, and one
      // that holds the delete action without a length of its own.
      profiles.push(
        saved('p-temp', 'Temp', { expiration: 'DAY', expiryAction: 'DELETE' }),
        saved('p-action', 'Action only', { expiryAction: 'DELETE' })
      )
    })

    // A new length reaches uploads that name an action themselves, so it
    // needs what either action needs.
    const BOTH = 'both'
    const OWN_ACTION: Record<string, string> = {
      [DELETES]:
        'that ask to be deleted when they expire would be deleted after the new time',
      [HIDES]:
        'that ask to be made private when they expire would be made private after the new time',
    }

    describe.each<[string, Default, object, string | null, typeof BOTH?]>([
      [
        'a new profile that deletes after a week',
        OFF,
        { name: 'New', expiry: 'week', expiry_action: 'delete' },
        DELETES,
        BOTH,
      ],
      [
        'a new profile that makes private after a week',
        OFF,
        { name: 'New', expiry: 'week', expiry_action: 'make_private' },
        HIDES,
        BOTH,
      ],
      [
        'a new profile with a length, whose action is an account default that deletes',
        ['DISABLED', 'DELETE'],
        { name: 'New', expiry: 'hour' },
        DELETES,
        BOTH,
      ],
      [
        'a new profile with a length, whose action is an account default that makes private',
        ['DISABLED', 'SET_PRIVATE'],
        { name: 'New', expiry: 'hour' },
        HIDES,
        BOTH,
      ],
      // An action is kept even while no length applies, so it is checked.
      [
        'a new profile with only the delete action, while the account has no default length',
        ['DISABLED', 'SET_PRIVATE'],
        { name: 'New', expiry_action: 'delete' },
        DELETES,
      ],
      [
        'a new profile with only the make-private action, while the account has no default length',
        ['DISABLED', 'DELETE'],
        { name: 'New', expiry_action: 'make_private' },
        HIDES,
      ],
      [
        'the delete action on a profile without a length, while the account has none',
        OFF,
        { profile: 'Private', expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the action taken out of a profile without a length, while the account has none',
        OFF,
        { profile: 'Action only', expiry_action: null },
        null,
      ],
      [
        'a new profile with only the delete action, whose length is an account default of a week',
        ['WEEK', 'SET_PRIVATE'],
        { name: 'New', expiry_action: 'delete' },
        DELETES,
      ],
      [
        'a new profile with only the make-private action, over an account default that deletes after a day',
        ['DAY', 'DELETE'],
        { name: 'New', expiry_action: 'make_private' },
        HIDES,
      ],
      [
        'a new profile that never expires and names the delete action',
        ['WEEK', 'SET_PRIVATE'],
        { name: 'New', expiry: 'never', expiry_action: 'delete' },
        DELETES,
      ],
      [
        'a new profile that never expires and names no action',
        ['WEEK', 'DELETE'],
        { name: 'New', expiry: 'never' },
        null,
      ],
      // A new profile is judged against what uploads did without it: the
      // account alone. Inheriting what the account does changes nothing.
      [
        'a new profile that sets no expiry, while the account default deletes',
        ['WEEK', 'DELETE'],
        { name: 'New', visibility: 'private' },
        null,
      ],
      [
        'a new profile with only tags, while the account default deletes',
        ['WEEK', 'DELETE'],
        { name: 'New', tags: ['Work'] },
        null,
      ],
      [
        'a new profile that deletes sooner than the account default',
        ['WEEK', 'DELETE'],
        { name: 'New', expiry: 'day' },
        DELETES,
        BOTH,
      ],
      [
        'a new default profile that inherits an account default that deletes',
        ['WEEK', 'DELETE'],
        { name: 'New', make_default: true },
        null,
      ],
      [
        'a new default profile, while the account has no default expiry',
        OFF,
        { name: 'New', make_default: true },
        null,
      ],
      [
        'another length on a profile that already makes private',
        OFF,
        { profile: 'Screenshots', expiry: 'day' },
        HIDES,
        BOTH,
      ],
      [
        'the delete action on a profile that has a length',
        OFF,
        { profile: 'Screenshots', expiry_action: 'delete' },
        DELETES,
      ],
      [
        'the length taken out of a profile, while the account has no default length',
        OFF,
        { profile: 'Screenshots', expiry: null },
        null,
      ],
      [
        'the length taken out of a profile that makes private, which then follows an account default of a day and still makes private',
        ['DAY', 'DELETE'],
        { profile: 'Screenshots', expiry: null },
        HIDES,
        BOTH,
      ],
      [
        // Nothing expires on its own afterwards, but an upload that brings
        // an expiry takes the action the profile now leaves to the account.
        'the length and the make-private action taken out of a profile, over an account action that deletes',
        OFF,
        { profile: 'Screenshots', expiry: null, expiry_action: null },
        DELETES,
      ],
      [
        'the length and the action taken out of a profile, over the same action on the account',
        ['DISABLED', 'SET_PRIVATE'],
        { profile: 'Screenshots', expiry: null, expiry_action: null },
        null,
      ],
      [
        'the action taken out of a profile with a length, which then follows an account default that deletes',
        ['DISABLED', 'DELETE'],
        { profile: 'Screenshots', expiry_action: null },
        DELETES,
      ],
      [
        'the expiry turned off on a profile that deletes',
        OFF,
        { profile: 'Temp', expiry: 'never' },
        null,
      ],
      [
        'only a new name for a profile that already deletes',
        OFF,
        { profile: 'Temp', name: 'Renamed' },
        null,
      ],
      [
        'only the visibility of a profile that already deletes',
        OFF,
        { profile: 'Temp', visibility: 'private' },
        null,
      ],
      [
        'the length a profile that deletes already has, beside another setting',
        OFF,
        { profile: 'Temp', expiry: 'day', share_style: 'minimal' },
        null,
      ],
      [
        'a profile that already deletes as the default',
        OFF,
        { profile: 'Temp', make_default: true },
        DELETES,
        BOTH,
      ],
      [
        'a profile that already deletes as no longer the default',
        OFF,
        { profile: 'Temp', make_default: false },
        null,
      ],
      // Uploads that name no profile made private before, and still do.
      [
        'a profile without an expiry as the default, while the account default makes private after a week',
        ['WEEK', 'SET_PRIVATE'],
        { profile: 'Private', make_default: true },
        null,
      ],
      [
        'a profile that makes private as the default, while the account has no default expiry',
        OFF,
        { profile: 'Screenshots', make_default: true },
        HIDES,
        BOTH,
      ],
    ])('a call that sets %s', (_what, [length, action], args, effect, both) => {
      beforeEach(() => {
        row.defaultFileExpiration = length
        row.defaultFileExpirationAction = action
        // The profile that is no longer the default was the default.
        if ('make_default' in args && args.make_default === false)
          row.defaultUploadProfileId = 'p-temp'
      })
      const savedSomething = () =>
        mocks.create.mock.calls.length +
        mocks.update.mock.calls.length +
        mocks.setDefault.mock.calls.length

      if (!effect) {
        it('needs neither expiry effect', async () => {
          await call('save_upload_profile', args, base)
          expect(savedSomething()).toBeGreaterThan(0)
        })
        return
      }
      const other = effect === DELETES ? HIDES : DELETES
      const needs = TOOL_CATALOG.save_upload_profile.effects[
        effect as typeof DELETES
      ] as ToolNeeds

      it(`needs ${effect}, and changes nothing without it`, async () => {
        const error = await refusal('save_upload_profile', args, base)
        expect(error.outcome).toBe('denied')
        expect(error.message).toContain(`Not allowed: ${effect}`)
        expectNothingChanged()
      })

      it('is refused with the scope but not the role permission, and the other way round', async () => {
        for (const grant of [
          {
            scopes: [...base.scopes, ...needs.scopes],
            permissions: base.permissions,
          },
          {
            scopes: base.scopes,
            permissions: [...base.permissions, ...needs.permissions],
          },
          // What the other expiry action needs is no help.
          granted('save_upload_profile', other),
        ])
          expect(
            (await refusal('save_upload_profile', args, grant)).message
          ).toContain(`Not allowed: ${effect}`)
        expectNothingChanged()
      })

      it(`is allowed with the scope and the role permission${both ? ' of both' : ''}`, async () => {
        const { structured } = await call(
          'save_upload_profile',
          args,
          granted('save_upload_profile', effect, ...(both ? [other] : []))
        )
        // Answered with the profile; a call that asks for what the profile
        // already has saves nothing more.
        expect(structured.profile).toMatchObject({ id: expect.any(String) })
      })

      if (both)
        it(`needs ${other} too, for uploads that name that action themselves`, async () => {
          const error = await refusal(
            'save_upload_profile',
            args,
            granted('save_upload_profile', effect)
          )
          expect(error.outcome).toBe('denied')
          expect(error.message).toContain(OWN_ACTION[other])
          expect(error.message).toContain(`Not allowed: ${other}`)
          expectNothingChanged()
        })
    })

    it('lets no action wait on a profile for the account default to switch it on', async () => {
      // The account has no default length, so nothing would expire yet. A
      // length set on the account later is judged by the account's action
      // alone, so the profile's is judged now.
      const sharing = granted('save_upload_profile', HIDES)
      for (const args of [
        { profile: 'Private', expiry_action: 'delete' },
        { name: 'Parked', expiry_action: 'delete', make_default: true },
      ])
        expect(
          (await refusal('save_upload_profile', args, sharing)).message
        ).toBe(`Not allowed: ${DELETES}`)
      // Refused before any profile is looked up.
      expect(mocks.profiles).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it('works the action out the way an upload with the profile would', async () => {
      // The profile's own action wins over the account default.
      row.defaultFileExpiration = 'WEEK'
      row.defaultFileExpirationAction = 'DELETE'
      const args = { profile: 'Screenshots', expiry: 'hour' }
      // So the first thing asked for is what making private needs.
      expect((await refusal('save_upload_profile', args, base)).message).toBe(
        `Uploads with the profile "Screenshots" would be made private when they expire. Not allowed: ${HIDES}`
      )
      await call(
        'save_upload_profile',
        args,
        granted('save_upload_profile', HIDES, DELETES)
      )
      expect(mocks.update.mock.calls[0][3].options).toMatchObject({
        expiration: 'HOUR',
        expiryAction: 'SET_PRIVATE',
      })
    })
  })

  describe('a token bound to an upload profile', () => {
    beforeEach(() => {
      boundTo = 'p-screens'
    })
    const everything = granted('save_upload_profile', DELETES, HIDES)

    it.each<[string, object]>([
      ['a new profile', { name: 'New', visibility: 'private' }],
      ['the profile it is bound to', { profile: 'p-screens', expiry: 'never' }],
      ['another profile', { profile: 'Private', share_style: 'framed' }],
      ['the default', { profile: 'Private', make_default: true }],
      ['nothing at all', { profile: 'Private' }],
    ])('cannot save %s, whatever else it may do', async (_what, args) => {
      const error = await refusal('save_upload_profile', args, everything)
      expect(error.outcome).toBe('denied')
      expect(error.message).toBe(
        'This token is bound to the upload profile "Screenshots", so it cannot change upload profiles. Use a connection that is not bound to a profile.'
      )
      // Refused before any profile is looked up by what the call names.
      expect(mocks.profiles).not.toHaveBeenCalled()
      expect(mocks.tags).not.toHaveBeenCalled()
      expectNothingChanged()
    })

    it('names a bound profile that no longer exists by its ID', async () => {
      boundTo = 'p-deleted'
      const error = await refusal('save_upload_profile', { name: 'New' })
      expect(error.message).toBe(
        'This token is bound to the upload profile p-deleted, so it cannot change upload profiles. Use a connection that is not bound to a profile.'
      )
      expectNothingChanged()
    })

    it("does not take another account's profile for the binding", async () => {
      await refusal('save_upload_profile', { name: 'New' })
      expect(mocks.profileNow).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'p-screens', userId: 'owner' },
        select: { name: true },
      })
    })
  })

  it('takes no argument it does not describe', () => {
    const { input } = tool('save_upload_profile')
    expect(Object.keys(input.shape).sort()).toEqual([
      'expiry',
      'expiry_action',
      'make_default',
      'name',
      'profile',
      'randomize_file_urls',
      'revision',
      'share_style',
      'tags',
      'visibility',
    ])
    for (const args of [
      { name: 'New', password: 'secret' },
      { name: 'New', folder: 'Work' },
      { name: 'New', copyFormat: 'markdown' },
      { name: 'New', visibility: 'unlisted' },
      { name: 'New', share_style: 'fancy' },
      { name: 'x'.repeat(81) },
      { name: ' ' },
    ])
      expect(input.safeParse(args).success, JSON.stringify(args)).toBe(false)
    expect(input.safeParse({ name: 'x'.repeat(80) }).success).toBe(true)
  })

  describe('what the model is told', () => {
    const { description, input } = tool('save_upload_profile')
    const told = (argument: string) => input.shape[argument].description ?? ''

    it('says in about a hundred words what a profile is and what saving one touches', () => {
      expect(description.split(/\s+/).length).toBeLessThanOrEqual(110)
      for (const sentence of [
        'Create an upload profile, or change the one `profile` names.',
        "When changing one, settings left out stay as they are, and a setting given as null is taken out, so uploads follow the account's own setting for it.",
        "Changes apply to later uploads only, and a profile's expiry applies to every later upload that uses it.",
        'Tokens bound to a profile follow its changes at once; a token bound to a profile cannot use this tool.',
        'Answers the profile with its new `revision`.',
      ])
        expect(description).toContain(sentence)
      expect(description).not.toMatch(/[\u2013\u2014]/)
    })

    it('keeps what one argument needs with that argument', () => {
      expect(told('profile')).toContain('Leave out to create one')
      expect(told('name')).toContain('required for a new profile')
      expect(told('expiry')).toContain(
        '`never` turns off a default expiry of the account and needs nothing more.'
      )
      expect(told('expiry')).toContain(
        'A length that is new for uploads with any profile or none, a profile taking what it leaves out from the account, needs a connection that may delete files and may change sharing: an upload can name either action itself and then takes this length'
      )
      expect(told('expiry_action')).toContain(
        "`delete` needs a connection that may delete files and `make_private` one that may change sharing, also while no length is set. `null` leaves the action to the account, and needs the same for the account's action when that is the other one"
      )
      expect(told('make_default')).toBe(
        'true: uploads that name no profile use this one. false: it stops being the default, and the account has none. Either changes how those uploads expire and whether they are public, which needs what `expiry` and `visibility` say'
      )
      expect(told('visibility')).toBe(
        'Who can open the files; private means only the owner, and null takes it out, which leaves them public. Making later uploads public where they were private needs a connection that may change sharing'
      )
      expect(told('revision')).toBe(
        'Only when changing a profile: the `revision` last answered for it, to have the edit refused if the profile changed since. Without it the changes go onto the profile as it is now'
      )
      expect(told('tags')).toContain('up to 20')
      for (const argument of Object.keys(input.shape)) {
        expect(told(argument).length, argument).toBeGreaterThan(10)
        expect(told(argument)).not.toMatch(/[\u2013\u2014]/)
      }
    })
  })
})

describe('delete_upload_profile', () => {
  it.each([
    ['its ID', 'p-screens'],
    ['its name', 'Screenshots'],
  ])('deletes the profile named by %s', async (_how, value) => {
    const { structured, audit } = await call('delete_upload_profile', {
      profile: value,
    })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'p-screens',
      expect.any(Function)
    )
    expect(structured).toEqual({ id: 'p-screens', name: 'Screenshots' })
    expect(audit).toMatchObject({
      targetType: 'upload_profile',
      targetId: 'p-screens',
      targetName: 'Screenshots',
    })
  })

  it('says when the default profile went with it', async () => {
    row.defaultUploadProfileId = 'p-screens'
    const { structured } = await call(
      'delete_upload_profile',
      { profile: 'Screenshots' },
      // Uploads that name no profile take the account's action again, which
      // deletes, where the profile made private.
      granted('delete_upload_profile', 'expiry_delete')
    )
    expect(structured).toEqual({
      id: 'p-screens',
      name: 'Screenshots',
      default_cleared: true,
    })
  })

  it('says so when the owner deleted the profile after the call found it', async () => {
    mocks.remove.mockImplementationOnce(async (_id, _profile, check: Check) => {
      profiles = profiles.filter(({ id }) => id !== 'p-screens')
      await check(tx)
      written.push('remove')
      return false
    })
    const error = await refusal('delete_upload_profile', {
      profile: 'Screenshots',
    })
    expect(error.message).toBe(
      'The upload profile "Screenshots" no longer exists: it was deleted in the meantime. Call get_account to see the upload profiles.'
    )
  })

  it('deletes nothing for a name that matches no profile', async () => {
    const error = await refusal('delete_upload_profile', { profile: 'Ghost' })
    expect(error.message).toBe(
      'No upload profile matches "Ghost". Call get_account to see the upload profiles.'
    )
    expect(mocks.profiles).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner' } })
    )
    expectNothingChanged()
  })

  it.each([
    ['the profile it is bound to', 'p-screens'],
    ['another profile', 'Private'],
    ['a profile that does not exist', 'Ghost'],
  ])(
    'refuses a token bound to an upload profile that deletes %s',
    async (_what, profile) => {
      boundTo = 'p-screens'
      const error = await refusal('delete_upload_profile', { profile })
      expect(error.outcome).toBe('denied')
      expect(error.message).toBe(
        'This token is bound to the upload profile "Screenshots", so it cannot change upload profiles. Use a connection that is not bound to a profile.'
      )
      expect(mocks.profiles).not.toHaveBeenCalled()
      expectNothingChanged()
    }
  )

  it('takes a profile and nothing else', () => {
    const { input } = tool('delete_upload_profile')
    expect(input.safeParse({}).success).toBe(false)
    expect(input.safeParse({ profile: '' }).success).toBe(false)
    expect(input.safeParse({ profile: 'A', force: true }).success).toBe(false)
  })

  it('tells the model what stops working', () => {
    const { description } = tool('delete_upload_profile')
    expect(description).toMatch(/tokens bound to it can no longer upload/)
    expect(description).toMatch(
      /A token bound to an upload profile cannot use this tool\./
    )
    expect(description).toMatch(
      /If it was the default profile, the account has no default afterwards/
    )
    expect(description).toMatch(/^Delete an upload profile\. Files already/)
    // Handing uploads back to the account can delete, hide or publish them.
    expect(description).toContain(
      'deleting, hiding or publishing them then needs Delete files or Change sharing.'
    )
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(110)
    expect(tool('delete_upload_profile').input.shape.profile.description).toBe(
      'The profile to delete: its ID or name from get_account'
    )
    expect(description).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the profile tools', () => {
  it('are the three account settings tools, each in the catalog under account:write', () => {
    expect(accountSettingsTools.map(({ name }) => name)).toEqual([
      'update_profile',
      'save_upload_profile',
      'delete_upload_profile',
    ])
    for (const { name } of accountSettingsTools)
      expect(TOOL_CATALOG[name].scopes).toEqual(['account:write'])
  })
})

describe('what an expiry change does to every way of uploading', () => {
  type Tool = 'update_profile' | 'save_upload_profile' | 'delete_upload_profile'
  const EFFECTS = {
    update_profile: {
      delete: 'default_expiry_delete',
      hide: 'default_expiry_make_private',
    },
    save_upload_profile: {
      delete: 'expiry_delete',
      hide: 'expiry_make_private',
    },
    delete_upload_profile: {
      delete: 'expiry_delete',
      hide: 'expiry_make_private',
    },
  } as const
  /** What a tool's row asks for, and the expiry effects named on top. */
  const may = (name: Tool, ...what: ('delete' | 'hide')[]) =>
    granted(name, ...what.map((effect) => EFFECTS[name][effect]))
  const DELETED = 'would be deleted when they expire.'
  const HIDDEN = 'would be made private when they expire.'

  /** The refusal, with nothing saved by any service. */
  async function refused(name: Tool, args: object, grant: Grant) {
    const error = await refusal(name, args, grant)
    expect(error.outcome).toBe('denied')
    expectNothingChanged()
    return error.message
  }
  const account = (
    length: AccountRow['defaultFileExpiration'],
    action: AccountRow['defaultFileExpirationAction'],
    defaultProfile: string | null = null
  ) => {
    row.defaultFileExpiration = length
    row.defaultFileExpirationAction = action
    row.defaultUploadProfileId = defaultProfile
  }

  describe('a new default expiry for the account', () => {
    it('is refused when a profile that names only the delete action would start deleting', async () => {
      // The owner made this profile in the browser: it deletes, once the
      // account gives it a length.
      account('DISABLED', 'SET_PRIVATE')
      profiles = [saved('p-temp', 'Temp', { expiryAction: 'DELETE' })]
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'hour' },
          may('update_profile', 'hide')
        )
      ).toBe(
        `Uploads with the profile "Temp" ${DELETED} Not allowed: default_expiry_delete. Nothing was changed.`
      )
      expect(row.defaultFileExpiration).toBe('DISABLED')

      await call(
        'update_profile',
        { default_expiry: 'hour' },
        may('update_profile', 'hide', 'delete')
      )
      expect(written).toEqual(['saveSettings'])
      expect(row.defaultFileExpiration).toBe('HOUR')
    })

    it('is refused when a profile that names only the make-private action would start hiding', async () => {
      account('DISABLED', 'DELETE')
      profiles = [saved('p-hide', 'Hide', { expiryAction: 'SET_PRIVATE' })]
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'day' },
          may('update_profile', 'delete')
        )
      ).toBe(
        `Uploads with the profile "Hide" ${HIDDEN} Not allowed: default_expiry_make_private. Nothing was changed.`
      )
      await call(
        'update_profile',
        { default_expiry: 'day' },
        may('update_profile', 'delete', 'hide')
      )
      expect(written).toEqual(['saveSettings'])
    })

    it('judges a profile that inherits the length, one that inherits the action, and one that inherits both', async () => {
      account('DISABLED', 'SET_PRIVATE')
      profiles = [
        saved('p-length', 'Inherits length', { expiryAction: 'DELETE' }),
        saved('p-action', 'Inherits action', { expiration: 'DAY' }),
        saved('p-both', 'Inherits both'),
      ]
      // The action that applies to the other two is the account's own.
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'week' },
          may('update_profile', 'hide')
        )
      ).toBe(
        `Uploads with the profile "Inherits length" ${DELETED} Not allowed: default_expiry_delete. Nothing was changed.`
      )
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'week' },
          may('update_profile', 'delete')
        )
      ).toBe(
        `Uploads that name no profile or \`none\` and uploads with the profile "Inherits both" ${HIDDEN} Not allowed: default_expiry_make_private. Nothing was changed.`
      )
      await call(
        'update_profile',
        { default_expiry: 'week' },
        may('update_profile', 'delete', 'hide')
      )
      expect(written).toEqual(['saveSettings'])
    })

    it('judges a new action by the profile that has its own length', async () => {
      account('DISABLED', 'DELETE')
      profiles = [saved('p-action', 'Inherits action', { expiration: 'DAY' })]
      // Naming the action needs its effect, and that is all this needs:
      // the profile already deleted, and now makes private.
      await call(
        'update_profile',
        { default_expiry_action: 'make_private' },
        may('update_profile', 'hide')
      )
      expect(written).toEqual(['saveSettings'])
      account('DISABLED', 'SET_PRIVATE')
      written = []
      expect(
        await refused(
          'update_profile',
          { default_expiry_action: 'delete' },
          may('update_profile', 'hide')
        )
      ).toBe('Not allowed: default_expiry_delete')
    })

    it('names the default profile too when it inherits the change', async () => {
      account('DISABLED', 'DELETE', 'p-main')
      profiles = [
        saved('p-main', 'Main'),
        saved('p-own', 'Own', { expiration: 'DISABLED' }),
      ]
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'month' },
          may('update_profile', 'hide')
        )
      ).toBe(
        `Uploads that name no profile, uploads that name the profile \`none\` and uploads with the profile "Main" ${DELETED} Not allowed: default_expiry_delete. Nothing was changed.`
      )
    })

    it('needs the effect for a new length on uploads that already delete, and nothing for the length they have', async () => {
      account('WEEK', 'DELETE', 'p-temp')
      profiles = [saved('p-temp', 'Temp', { expiryAction: 'DELETE' })]
      expect(
        await refused(
          'update_profile',
          { default_expiry: 'hour', name: 'Mira' },
          may('update_profile', 'hide')
        )
      ).toBe(
        `Uploads that name no profile, uploads that name the profile \`none\` and uploads with the profile "Temp" ${DELETED} Not allowed: default_expiry_delete. Nothing was changed.`
      )
      expect(written).toEqual([])
      await call('update_profile', { default_expiry: 'week', name: 'Mira' })
      expect(written).toEqual(['saveSettings'])
    })
  })

  describe('the default profile', () => {
    describe.each([
      ['save_upload_profile', { profile: 'Keep', make_default: false }],
      ['delete_upload_profile', { profile: 'Keep' }],
    ] as const)('stopped being the default by %s', (name, args) => {
      it.each([
        ['DELETE', 'delete', 'hide', DELETED, 'expiry_delete'],
        ['SET_PRIVATE', 'hide', 'delete', HIDDEN, 'expiry_make_private'],
      ] as const)(
        'hands uploads that name no profile to an account default that does %s, which needs that effect',
        async (action, needed, other, would, effect) => {
          // The default profile holds the account's hour-long expiry off.
          account('HOUR', action, 'p-keep')
          profiles = [saved('p-keep', 'Keep', { expiration: 'DISABLED' })]
          expect(await refused(name, args, may(name, other))).toBe(
            `Uploads that name no profile ${would} Not allowed: ${effect}`
          )
          // The length is new for those uploads too, and an upload can
          // name the other action itself: that needs the other effect.
          expect(await refused(name, args, may(name, needed))).toContain(
            'after the new time. Not allowed: '
          )
          expect(row.defaultUploadProfileId).toBe('p-keep')
          await call(name, args, may(name, needed, other))
          expect(row.defaultUploadProfileId).toBeNull()
        }
      )
    })

    it('needs nothing to delete a profile that is not the default, however it expires', async () => {
      account('HOUR', 'DELETE', 'p-keep')
      profiles = [
        saved('p-keep', 'Keep', { expiration: 'DISABLED' }),
        saved('p-temp', 'Temp', { expiration: 'DAY', expiryAction: 'DELETE' }),
      ]
      const { structured } = await call('delete_upload_profile', {
        profile: 'Temp',
      })
      expect(structured).toEqual({ id: 'p-temp', name: 'Temp' })
      expect(written).toEqual(['remove'])
    })

    it.each([
      ['DELETE', 'hide', DELETED, 'expiry_delete'],
      ['SET_PRIVATE', 'delete', HIDDEN, 'expiry_make_private'],
    ] as const)(
      'needs what a profile that does %s does to become the default',
      async (action, other, would, effect) => {
        account('DISABLED', 'DELETE')
        profiles = [
          saved('p-temp', 'Temp', { expiration: 'DAY', expiryAction: action }),
        ]
        expect(
          await refused(
            'save_upload_profile',
            { profile: 'Temp', make_default: true },
            may('save_upload_profile', other)
          )
        ).toBe(`Uploads that name no profile ${would} Not allowed: ${effect}`)
      }
    )

    it('saves neither the profile nor the default when making it the default is refused', async () => {
      account('DISABLED', 'DELETE')
      profiles = [
        saved('p-temp', 'Temp', { expiration: 'DAY', expiryAction: 'DELETE' }),
      ]
      expect(
        await refused(
          'save_upload_profile',
          { profile: 'Temp', share_style: 'minimal', make_default: true },
          may('save_upload_profile', 'hide')
        )
      ).toBe(
        `Uploads that name no profile ${DELETED} Not allowed: expiry_delete`
      )
      expect(row.defaultUploadProfileId).toBeNull()
    })

    it('saves neither a new name nor the default when stopping it being the default is refused', async () => {
      // The default profile holds off the account's day-long deleting.
      account('DAY', 'DELETE', 'p-safe')
      profiles = [saved('p-safe', 'Safe', { expiration: 'DISABLED' })]
      const before = structuredClone(profiles)
      const args = { profile: 'Safe', name: 'Renamed', make_default: false }
      expect(
        await refused(
          'save_upload_profile',
          args,
          may('save_upload_profile', 'hide')
        )
      ).toBe(
        `Uploads that name no profile ${DELETED} Not allowed: expiry_delete`
      )
      expect(mocks.update).not.toHaveBeenCalled()
      expect(profiles).toEqual(before)
      expect(row.defaultUploadProfileId).toBe('p-safe')
      // With Delete files and Change sharing, both are saved: the length
      // those uploads get is new, which needs what either action needs.
      await call(
        'save_upload_profile',
        args,
        may('save_upload_profile', 'delete', 'hide')
      )
      expect(written).toEqual(['update', 'setDefault'])
      expect(mocks.update.mock.calls[0][3]).toMatchObject({ name: 'Renamed' })
      expect(row.defaultUploadProfileId).toBeNull()
    })
  })

  describe('a profile created or changed', () => {
    it('is refused for a new profile that deletes, naming it', async () => {
      account('DISABLED', 'DELETE')
      expect(
        await refused(
          'save_upload_profile',
          { name: 'New', expiry: 'day' },
          may('save_upload_profile', 'hide')
        )
      ).toBe(
        `Uploads with the profile "New" ${DELETED} Not allowed: expiry_delete`
      )
    })

    it.each<[string, object]>([
      ['a new name', { name: 'Renamed' }],
      ['other tags', { tags: ['Old'] }],
      ['another visibility', { visibility: 'private' }],
    ])(
      'needs nothing for %s, though the profile and the default already delete',
      async (_what, change) => {
        account('WEEK', 'DELETE', 'p-temp')
        profiles = [
          saved('p-temp', 'Temp', {
            expiration: 'DAY',
            expiryAction: 'DELETE',
          }),
          saved('p-plain', 'Plain'),
        ]
        await call('save_upload_profile', { profile: 'Temp', ...change })
        expect(written).toEqual(['update'])
      }
    )

    it('judges the account as the service finds it, not as the call first read it', async () => {
      account('DISABLED', 'SET_PRIVATE', 'p-keep')
      profiles = [saved('p-keep', 'Keep')]
      // Between the call's own reads and the save, the owner switches the
      // account's action to delete in the browser. The profile's revision
      // does not cover the account, so only the check can see it.
      mocks.save.mockImplementationOnce(async (...args) => {
        row.defaultFileExpirationAction = 'DELETE'
        return saveTogether(...(args as Parameters<typeof saveTogether>))
      })
      expect(
        await refused(
          'save_upload_profile',
          { profile: 'Keep', expiry: 'hour' },
          may('save_upload_profile', 'hide')
        )
      ).toBe(
        `Uploads that name no profile and uploads with the profile "Keep" ${DELETED} Not allowed: expiry_delete`
      )
    })
  })
})

describe('what a change does to the visibility of later uploads', () => {
  type Tool = 'save_upload_profile' | 'delete_upload_profile'
  const SHARING = (name: Tool) => granted(name, 'visibility_public')
  const PUBLIC = 'Not allowed: visibility_public'

  /** The refusal, with nothing saved by any service. */
  async function refused(name: Tool, args: object) {
    const error = await refusal(name, args)
    expect(error.outcome).toBe('denied')
    expectNothingChanged()
    return error.message
  }
  // The default profile keeps uploads private; another profile is public.
  beforeEach(() => {
    row.defaultUploadProfileId = 'p-private'
  })

  it.each<[string, Tool, object, string]>([
    [
      'makes the private default public',
      'save_upload_profile',
      { profile: 'Private', visibility: 'public' },
      'Uploads that name no profile and uploads with the profile "Private" would be public.',
    ],
    [
      'takes the visibility out of the private default, which uploads then take as public',
      'save_upload_profile',
      { profile: 'Private', visibility: null },
      'Uploads that name no profile and uploads with the profile "Private" would be public.',
    ],
    [
      'stops the private profile being the default',
      'save_upload_profile',
      { profile: 'Private', make_default: false },
      'Uploads that name no profile would be public.',
    ],
    [
      'deletes the private default',
      'delete_upload_profile',
      { profile: 'Private' },
      'Uploads that name no profile would be public.',
    ],
    [
      'creates a public profile as the default over the private one',
      'save_upload_profile',
      { name: 'Open', visibility: 'public', make_default: true },
      'Uploads that name no profile would be public.',
    ],
  ])(
    'refuses a call that %s without Change sharing',
    async (_what, name, args, uploads) => {
      expect(await refused(name, args)).toBe(`${uploads} ${PUBLIC}`)
      expect(row.defaultUploadProfileId).toBe('p-private')
      await call(name, args, SHARING(name))
      expect(written.length).toBeGreaterThan(0)
    }
  )

  it('needs nothing to keep uploads private, or to make them private', async () => {
    await call('save_upload_profile', { profile: 'Private', name: 'Hidden' })
    await call('save_upload_profile', {
      profile: 'Screenshots',
      visibility: 'private',
    })
    await call('save_upload_profile', {
      name: 'Shut',
      visibility: 'private',
      make_default: true,
    })
    expect(written).toEqual(['update', 'update', 'create', 'setDefault'])
  })

  it('needs nothing where the role keeps every upload private', async () => {
    owner.shares = false
    await call('save_upload_profile', {
      profile: 'Private',
      visibility: 'public',
    })
    await call('save_upload_profile', {
      profile: 'Private',
      make_default: false,
    })
    expect(written).toEqual(['update', 'setDefault'])
  })

  it('needs nothing for a new public profile that is not the default', async () => {
    // Uploads that name `none` are public already, as the account has it.
    await call('save_upload_profile', { name: 'Open', visibility: 'public' })
    expect(written).toEqual(['create'])
  })

  it('judges a new visibility and the default together, once', async () => {
    // Made public and the default over a private default: one change,
    // refused for both of the paths it publishes, with nothing saved.
    profiles[1] = saved('p-screens', 'Screenshots', { visibility: 'PRIVATE' })
    const args = {
      profile: 'Screenshots',
      visibility: 'public',
      make_default: true,
    }
    expect(await refused('save_upload_profile', args)).toBe(
      `Uploads that name no profile and uploads with the profile "Screenshots" would be public. ${PUBLIC}`
    )
    await call('save_upload_profile', args, SHARING('save_upload_profile'))
    expect(written).toEqual(['update', 'setDefault'])
    expect(row.defaultUploadProfileId).toBe('p-screens')
  })
})

describe('the last check, in the transaction that saves', () => {
  const ENDED = new ToolError(
    'This connection was disconnected, lost the access this call needs, or the MCP server was turned off while the call was running.',
    'denied'
  )
  /** Each call goes to one service, which runs the check it is handed. */
  const SAVES: [ToolName, string, unknown, string[]][] = [
    ['update_profile', 'saveSettings', { name: 'Mira' }, []],
    ['update_profile', 'saveTheme', { theme_mode: 'dark' }, ['theme_mode']],
    ['update_profile', 'saveEmbed', { embed: { title: 'Mine' } }, ['embed']],
    ['update_profile', 'removeAvatar', { avatar_file: null }, []],
    [
      'update_profile',
      'uploadAvatar',
      { avatar_file: 'f-me' },
      ['avatar_file'],
    ],
    ['save_upload_profile', 'create', { name: 'Another' }, []],
    ['delete_upload_profile', 'remove', { profile: 'Private' }, []],
  ]

  it.each(SAVES)(
    '%s hands %s the check, which runs before it writes',
    async (name, service, args, effects) => {
      mocks.recheck.mockImplementation(async () => {
        expect(written).toEqual([])
      })
      await call(name, args, granted(name, ...effects))
      expect(mocks.recheck).toHaveBeenCalledExactlyOnceWith(tx)
      expect(written).toContain(service)
    }
  )

  it.each(SAVES)(
    '%s saves nothing through %s when the check refuses',
    async (name, _service, args, effects) => {
      mocks.recheck.mockRejectedValue(ENDED)
      const error = await refusal(name, args, granted(name, ...effects))
      expect(error.message).toBe(`${ENDED.message} Nothing was changed.`)
      expect(error.outcome).toBe('denied')
      expectNothingChanged()
    }
  )

  it('runs the check in every service of one call, and says what was saved before a refusal', async () => {
    mocks.recheck.mockResolvedValueOnce(undefined).mockRejectedValueOnce(ENDED)
    const error = await refusal(
      'update_profile',
      { name: 'Mira', theme_mode: 'dark', embed: { title: 'Mine' } },
      granted('update_profile', 'theme_mode', 'embed')
    )
    expect(error.message).toBe(
      `${ENDED.message} Saved before that: \`name\`. Not saved: \`theme_mode\`, \`embed\`. Call again with only what was not saved.`
    )
    expect(written).toEqual(['saveSettings'])
  })

  it('judges what a change does to later uploads first, so the check covers the effect it required', async () => {
    const order: string[] = []
    mocks.user.mockImplementation(async () => {
      order.push('upload state')
      return { ...row }
    })
    mocks.recheck.mockImplementation(async () => {
      order.push('recheck')
    })
    const save = mocks.saveSettings.getMockImplementation()!
    mocks.saveSettings.mockImplementation(async (...args) => {
      // From here on, what the service's transaction sees.
      order.length = 0
      await save(...args)
      order.push('written')
    })
    await call(
      'update_profile',
      { default_expiry: 'week' },
      granted(
        'update_profile',
        'default_expiry_delete',
        'default_expiry_make_private'
      )
    )
    expect(order.slice(0, 3)).toEqual(['upload state', 'recheck', 'written'])
  })

  describe('an image chosen as the avatar', () => {
    const choose = (grant: Grant) =>
      call('update_profile', { avatar_file: 'f-me' }, grant)
    const PLAIN = granted('update_profile', 'avatar_file')
    const SHARING = granted(
      'update_profile',
      'avatar_file',
      'avatar_private_file'
    )

    it('reads the file again in the publishing transaction, holding its row and never waiting for it', async () => {
      await choose(PLAIN)
      expect(mocks.fileNow).toHaveBeenCalledOnce()
      const [statement, ...values] = mocks.fileNow.mock.calls[0]
      expect((statement as string[]).join('?').replace(/\s+/g, ' ')).toContain(
        'FROM "File" WHERE "id" = ? AND "userId" = ? FOR SHARE SKIP LOCKED'
      )
      expect(values).toEqual(['f-me', 'owner'])
      // The file first, and the credential and the role after it.
      expect(mocks.fileNow.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.recheck.mock.invocationCallOrder[0]
      )
    })

    it.each<[string, { visibility: string; password: string | null }, string]>([
      ['made private', { visibility: 'PRIVATE', password: null }, 'private'],
      [
        'given a password',
        { visibility: 'PUBLIC', password: 'hash' },
        'protected by a password',
      ],
    ])(
      'is not published once the file was %s while it was read, without Change sharing',
      async (_what, now, hidden) => {
        mocks.fileNow.mockResolvedValue([now])
        const error = await refusal(
          'update_profile',
          { avatar_file: 'f-me' },
          PLAIN
        )
        expect(error.message).toBe(
          `"me.png" is ${hidden}, and an avatar is visible to anyone, so making it the avatar needs Change sharing. An image that is public and has no password does not. Not allowed: avatar_private_file It was hidden while the call was running. Nothing was changed.`
        )
        expect(error.outcome).toBe('denied')
        // The bytes were read while the file was still public.
        expect(mocks.stream).toHaveBeenCalledOnce()
        expectNothingChanged()
      }
    )

    it('is published for a connection that may change sharing, and the check then asks for that too', async () => {
      mocks.fileNow.mockResolvedValue([
        { visibility: 'PRIVATE', password: null },
      ])
      await choose(SHARING)
      expect(written).toEqual(['uploadAvatar'])
      expect(mocks.recheck).toHaveBeenCalledOnce()
    })

    it('is not published when the file is gone or held by a change', async () => {
      mocks.fileNow.mockResolvedValue([])
      const error = await refusal(
        'update_profile',
        { avatar_file: 'f-me' },
        SHARING
      )
      expect(error.message).toBe(
        '"me.png" was deleted or is being changed right now, so it was not made the avatar. Call again if it should still be. Nothing was changed.'
      )
      expect(mocks.recheck).not.toHaveBeenCalled()
      expectNothingChanged()
    })
  })
})
