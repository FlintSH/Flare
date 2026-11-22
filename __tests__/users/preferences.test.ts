import { PATCH as saveThemeMode } from '@/app/api/customization/preferences/route'
import { POST as hideTipRoute } from '@/app/api/profile/tips/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savePersonalAppearance } from '@/lib/customization/personal'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { personalEmbedsAllowed, savePersonalEmbed } from '@/lib/embeds/personal'
import { DEFAULT_PERSONAL_EMBED } from '@/lib/embeds/schema'
import { savePreference } from '@/lib/users/preferences'
import { hideTip, readHiddenTips } from '@/lib/users/tips'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  lock: vi.fn(),
  personalEmbeds: true,
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => {
  const user = { findUniqueOrThrow: mocks.findUser, update: mocks.updateUser }
  return {
    prisma: {
      user,
      $transaction: (run: (tx: unknown) => unknown) =>
        run({ user, $queryRaw: mocks.lock }),
    },
  }
})
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          ...DEFAULT_APPEARANCE,
          sharing: {
            ...DEFAULT_APPEARANCE.sharing,
            personalEmbeds: mocks.personalEmbeds,
          },
        },
      },
    },
  }),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
  mocks.personalEmbeds = true
  mocks.findUser.mockResolvedValue({ preferences: {} })
})

const savedPreferences = () => mocks.updateUser.mock.calls.at(-1)![0]

describe('saving one part of the preferences', () => {
  it('keeps the other parts, with the account row locked first', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: { embed: { mode: 'rich' }, other: 1 },
    })
    await savePreference('owner', 'customization', { themeMode: 'dark' })
    expect(mocks.findUser).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'owner' },
      select: { preferences: true },
    })
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'owner' },
      data: {
        preferences: {
          embed: { mode: 'rich' },
          other: 1,
          customization: { themeMode: 'dark' },
        },
      },
    })
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findUser.mock.invocationCallOrder[0]
    )
    // The row lock names the account.
    expect(mocks.lock.mock.calls[0]).toContain('owner')
  })

  it('replaces the part it saves', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: { customization: { themeMode: 'dark' } },
    })
    await savePreference('owner', 'customization', { themeMode: 'light' })
    expect(savedPreferences().data.preferences).toEqual({
      customization: { themeMode: 'light' },
    })
  })

  it('hands a function the part as it stands under the lock, and saves its answer', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: { embed: { mode: 'rich', title: 'Browser' }, other: 1 },
    })
    const change = vi.fn((current: unknown) => ({
      ...(current as object),
      author: 'Agent',
    }))
    expect(await savePreference('owner', 'embed', change)).toEqual({
      mode: 'rich',
      title: 'Browser',
      author: 'Agent',
    })
    expect(change).toHaveBeenCalledExactlyOnceWith({
      mode: 'rich',
      title: 'Browser',
    })
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      change.mock.invocationCallOrder[0]
    )
    expect(savedPreferences().data.preferences).toEqual({
      embed: { mode: 'rich', title: 'Browser', author: 'Agent' },
      other: 1,
    })
  })

  it.each([[null], ['text'], [[1, 2]], [7]])(
    'starts from nothing when the saved preferences are %j',
    async (preferences) => {
      mocks.findUser.mockResolvedValue({ preferences })
      await savePreference('owner', 'embed', { mode: 'rich' })
      expect(savedPreferences().data.preferences).toEqual({
        embed: { mode: 'rich' },
      })
    }
  )
})

describe('the personal theme mode', () => {
  const account = { id: 'owner', permissions: ['appearance.personal'] }
  const patch = (body: unknown, origin = 'https://flare.example') =>
    saveThemeMode(
      new Request('https://flare.example/api/customization/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      })
    )

  it('is saved under `customization`, and answered as saved', async () => {
    expect(
      await savePersonalAppearance('owner', { themeMode: 'system' })
    ).toEqual({ themeMode: 'system' })
    expect(savedPreferences()).toEqual({
      where: { id: 'owner' },
      data: { preferences: { customization: { themeMode: 'system' } } },
    })
  })

  it.each(['inherit', 'system', 'light', 'dark'])(
    'is saved by the route as %s, beside the other preferences an account has',
    async (themeMode) => {
      mocks.session.mockResolvedValue({ user: account })
      mocks.findUser.mockResolvedValue({
        preferences: { embed: { mode: 'rich' } },
      })
      const response = await patch({ themeMode })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { themeMode } })
      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'owner' },
        data: {
          preferences: {
            embed: { mode: 'rich' },
            customization: { themeMode },
          },
        },
      })
    }
  )

  it('is `inherit` for a body that names no mode', async () => {
    mocks.session.mockResolvedValue({ user: account })
    const response = await patch({})
    expect(await response.json()).toEqual({ data: { themeMode: 'inherit' } })
    expect(savedPreferences().data.preferences).toEqual({
      customization: { themeMode: 'inherit' },
    })
  })

  it('is refused by the route for a mode it does not know, a visitor, a role without it, and other sites', async () => {
    mocks.session.mockResolvedValue({ user: account })
    for (const body of [{ themeMode: 'sepia' }, { themeMode: 'dark', x: 1 }]) {
      const response = await patch(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Choose inherit, system, light, or dark.',
      })
    }
    expect(
      (await patch({ themeMode: 'dark' }, 'https://elsewhere.example')).status
    ).toBe(403)
    mocks.session.mockResolvedValue({
      user: { id: 'owner', permissions: ['files.read'] },
    })
    expect((await patch({ themeMode: 'dark' })).status).toBe(403)
    mocks.session.mockResolvedValue(null)
    expect((await patch({ themeMode: 'dark' })).status).toBe(401)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})

describe('the personal embed', () => {
  const embed = { ...DEFAULT_PERSONAL_EMBED, mode: 'rich' as const }

  it('is saved under `embed`, and answered as saved', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: { customization: { themeMode: 'dark' } },
    })
    expect(await personalEmbedsAllowed()).toBe(true)
    expect(await savePersonalEmbed('owner', embed)).toEqual(embed)
    expect(savedPreferences()).toEqual({
      where: { id: 'owner' },
      data: {
        preferences: { customization: { themeMode: 'dark' }, embed },
      },
    })
  })

  it('saves a change onto the embed as it stands, read as the embed route reads it', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: { embed: { mode: 'direct', title: 'Browser' } },
    })
    const saved = await savePersonalEmbed('owner', (current) => ({
      ...current,
      author: 'Agent',
    }))
    expect(saved).toEqual({
      ...DEFAULT_PERSONAL_EMBED,
      mode: 'direct',
      title: 'Browser',
      author: 'Agent',
    })
    expect(savedPreferences().data.preferences).toEqual({ embed: saved })
  })

  it('is refused, before the account is read, where the instance uses one embed for every account', async () => {
    mocks.personalEmbeds = false
    expect(await personalEmbedsAllowed()).toBe(false)
    await expect(savePersonalEmbed('owner', embed)).rejects.toMatchObject({
      status: 403,
      message: 'This instance uses one embed for every account.',
    })
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.findUser).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})

describe('hidden tips', () => {
  const hide = (body: unknown, origin = 'https://flare.example') =>
    hideTipRoute(
      new Request('https://flare.example/api/profile/tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      })
    )

  it('reads only the tips Flare shows', () => {
    expect(readHiddenTips({ hidden: ['upload', 'gone', 3] })).toEqual([
      'upload',
    ])
    expect(readHiddenTips(undefined)).toEqual([])
    expect(readHiddenTips({ hidden: 'upload' })).toEqual([])
    expect(readHiddenTips(['upload'])).toEqual([])
  })

  it('are saved under `tips` once, beside the other preferences', async () => {
    mocks.findUser.mockResolvedValue({
      preferences: {
        customization: { themeMode: 'dark' },
        tips: { hidden: ['upload'] },
      },
    })
    expect(await hideTip('owner', 'upload')).toEqual(['upload'])
    expect(savedPreferences().data.preferences).toEqual({
      customization: { themeMode: 'dark' },
      tips: { hidden: ['upload'] },
    })
  })

  it('are hidden by the route for any signed-in account', async () => {
    // Hiding a tip changes only how Flare's pages look to the account, so
    // it needs no permission.
    mocks.session.mockResolvedValue({ user: { id: 'owner', permissions: [] } })
    const response = await hide({ hide: 'upload' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { hidden: ['upload'] } })
    expect(savedPreferences()).toEqual({
      where: { id: 'owner' },
      data: { preferences: { tips: { hidden: ['upload'] } } },
    })
  })

  it('refuses unknown tips, other sites and signed-out visitors', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner', permissions: [] } })
    for (const body of [{ hide: 'everything' }, {}, { hide: 'upload', x: 1 }]) {
      const response = await hide(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Choose a tip Flare shows.',
      })
    }
    expect(
      (await hide({ hide: 'upload' }, 'https://elsewhere.example')).status
    ).toBe(403)
    mocks.session.mockResolvedValue(null)
    expect((await hide({ hide: 'upload' })).status).toBe(401)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
