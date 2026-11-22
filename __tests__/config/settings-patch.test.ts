import { PATCH } from '@/app/api/settings/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS_NOT_SAVED } from '@/lib/config'
import { patchSettings } from '@/lib/config/patch'
import { loggers } from '@/lib/logger'
import { PermissionError } from '@/lib/permissions/server'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  actor: vi.fn(),
  apply: vi.fn(),
  administrator: vi.fn(),
  // Every step the transaction takes, in order.
  steps: [] as string[],
  tx: { fixture: 'transaction' },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  applyConfigUpdate: mocks.apply,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: (run: (tx: object) => unknown) => run(mocks.tx),
  },
}))
vi.mock('@/lib/database/locks', () => ({
  lockRoleChanges: vi.fn(async () => {
    mocks.steps.push('lock')
  }),
  lockSettings: vi.fn(),
}))
vi.mock('@/lib/permissions/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions/server')>()),
  assertAccessibleAdministrator: mocks.administrator,
  getUserAccess: mocks.access,
  requireActorPermission: mocks.actor,
}))

function patch(body: unknown) {
  return PATCH(
    new Request('https://flare.test/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.steps.length = 0
  mocks.session.mockResolvedValue({
    user: { id: 'member', permissions: ['settings.storage'] },
  })
  mocks.access.mockImplementation(async () => {
    mocks.steps.push('access')
    return { roles: [], permissions: ['settings.storage', 'files.read'] }
  })
  mocks.actor.mockImplementation(async () => {
    mocks.steps.push('actor')
  })
  mocks.apply.mockImplementation(async () => {
    mocks.steps.push('apply')
    return {}
  })
  mocks.administrator.mockImplementation(async () => {
    mocks.steps.push('administrator')
  })
})

describe('PATCH /api/settings', () => {
  it('rechecks authority under the role lock, then saves and checks an administrator remains', async () => {
    const response = await patch({
      settings: {
        general: {
          storage: {
            s3: { bucket: 'new', accessKeyId: '', secretAccessKey: '' },
          },
        },
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { message: 'Settings updated successfully' },
    })
    expect(mocks.steps).toEqual([
      'lock',
      'access',
      'actor',
      'apply',
      'administrator',
    ])
    expect(mocks.access).toHaveBeenCalledWith('member', mocks.tx)
    // The first permission the account holds now, read under the lock.
    expect(mocks.actor).toHaveBeenCalledWith(
      mocks.tx,
      'member',
      'settings.storage'
    )
    // Blank credentials are dropped, so the saved ones stay.
    expect(mocks.apply).toHaveBeenCalledWith(mocks.tx, {
      settings: { general: { storage: { s3: { bucket: 'new' } } } },
    })
    expect(mocks.administrator).toHaveBeenCalledWith(mocks.tx)
  })

  it('takes one section by name', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'member', permissions: ['appearance.manage'] },
    })
    mocks.access.mockResolvedValue({
      roles: [],
      permissions: ['appearance.manage'],
    })
    const response = await patch({
      section: 'appearance',
      data: { theme: 'light' },
    })
    expect(response.status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith(mocks.tx, {
      settings: { appearance: { theme: 'light' } },
    })
  })

  it.each([
    ['nothing', {}],
    ['a list', { settings: [1] }],
    ['text', { settings: 'general' }],
  ])('asks for settings when given %s', async (_case, body) => {
    const response = await patch(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Choose settings to update',
    })
    expect(mocks.steps).toEqual([])
  })

  it.each([
    ['a section the session cannot change', { appearance: { theme: 'light' } }],
    ['setup', { general: { setup: { completed: false } } }],
    ['the email section', { email: { enabled: true } }],
    ['an empty change', {}],
  ])('refuses %s before taking any lock', async (_case, settings) => {
    const response = await patch({ settings })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'You do not have permission to change these settings.',
    })
    expect(mocks.steps).toEqual([])
  })

  it('lets Security settings switch the MCP server but not administration through it', async () => {
    const security = { id: 'member', permissions: ['settings.security'] }
    mocks.session.mockResolvedValue({ user: security })
    mocks.access.mockImplementation(async () => {
      mocks.steps.push('access')
      return { roles: [], permissions: ['settings.security'] }
    })
    for (const mcp of [
      { administration: true },
      { enabled: true, administration: false },
    ]) {
      const response = await patch({ settings: { general: { mcp } } })
      expect(response.status, JSON.stringify(mcp)).toBe(403)
      expect(mocks.steps).toEqual([])
    }
    await expect(
      patchSettings(security, { general: { mcp: { administration: false } } })
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.apply).not.toHaveBeenCalled()
    const response = await patch({
      settings: { general: { mcp: { enabled: true } } },
    })
    expect(response.status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith(mocks.tx, {
      settings: { general: { mcp: { enabled: true } } },
    })
  })

  it('lets an administrator turn administration through MCP on or off, checked again under the lock', async () => {
    const administrator = { id: 'owner', permissions: ['administrator'] }
    mocks.access.mockImplementation(async () => {
      mocks.steps.push('access')
      return { roles: [], permissions: ['administrator'] }
    })
    await patchSettings(administrator, {
      general: { mcp: { administration: true } },
    })
    expect(mocks.steps).toEqual([
      'lock',
      'access',
      'actor',
      'apply',
      'administrator',
    ])
    // An administrator demoted since the session was issued is refused.
    mocks.steps.length = 0
    mocks.access.mockImplementation(async () => {
      mocks.steps.push('access')
      return { roles: [], permissions: ['settings.security'] }
    })
    await expect(
      patchSettings(administrator, {
        general: { mcp: { administration: false } },
      })
    ).rejects.toThrow('You no longer have permission to change these settings.')
    expect(mocks.steps).toEqual(['lock', 'access'])
  })

  it('refuses a grant removed since the session was issued, before saving', async () => {
    mocks.access.mockImplementation(async () => {
      mocks.steps.push('access')
      return { roles: [], permissions: ['files.read'] }
    })
    const response = await patch({
      settings: { general: { storage: { provider: 'local' } } },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'You no longer have permission to change these settings.',
    })
    expect(mocks.steps).toEqual(['lock', 'access'])
  })

  it('refuses an account that can no longer act, before saving', async () => {
    mocks.actor.mockRejectedValue(
      new PermissionError('Your account no longer has access')
    )
    const response = await patch({
      settings: { general: { storage: { provider: 'local' } } },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Your account no longer has access',
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('answers a save that would leave no administrator as the check words it', async () => {
    mocks.administrator.mockRejectedValue(
      new PermissionError('Flare needs at least one administrator', 409)
    )
    const response = await patch({
      settings: { general: { storage: { provider: 'local' } } },
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Flare needs at least one administrator',
    })
  })

  it('answers an unexpected failure with the settings message', async () => {
    const logged = vi
      .spyOn(loggers.config, 'error')
      .mockImplementation(() => {})
    mocks.apply.mockRejectedValue(new Error('connection reset'))
    const response = await patch({
      settings: { general: { storage: { provider: 'local' } } },
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: SETTINGS_NOT_SAVED,
    })
    expect(logged).toHaveBeenCalledOnce()
  })
})

describe('patchSettings', () => {
  const actor = { id: 'member', permissions: ['settings.storage'] }
  const storage = () => ({
    general: { storage: { s3: { bucket: 'new', accessKeyId: '' } } },
  })

  it('runs a caller check with the current access, after the permission checks and before saving', async () => {
    const check = vi.fn(async (tx: unknown, access: unknown) => {
      mocks.steps.push('check')
      expect(tx).toBe(mocks.tx)
      expect(access).toEqual({
        roles: [],
        permissions: ['settings.storage', 'files.read'],
      })
    })
    mocks.apply.mockImplementation(async () => {
      mocks.steps.push('apply')
      return { saved: true }
    })
    expect(await patchSettings(actor, storage(), { check })).toEqual({
      saved: true,
    })
    expect(mocks.steps).toEqual([
      'lock',
      'access',
      'actor',
      'check',
      'apply',
      'administrator',
    ])
  })

  it('saves nothing when the caller check refuses', async () => {
    const refusal = new PermissionError('Not through this client')
    await expect(
      patchSettings(actor, storage(), {
        check: () => {
          throw refusal
        },
      })
    ).rejects.toBe(refusal)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('runs a caller check only for an allowed change', async () => {
    const check = vi.fn()
    await expect(
      patchSettings(actor, { appearance: { theme: 'light' } }, { check })
    ).rejects.toThrow('You do not have permission to change these settings.')
    expect(check).not.toHaveBeenCalled()
  })

  it('lets a caller decide which credentials keep their saved values, under the lock', async () => {
    const credentials = vi.fn((settings: object, tx: unknown) => {
      mocks.steps.push('credentials')
      expect(tx).toBe(mocks.tx)
      expect(settings).toEqual(storage())
    })
    await patchSettings(actor, storage(), { credentials })
    expect(credentials).toHaveBeenCalledOnce()
    expect(mocks.steps.indexOf('credentials')).toBeGreaterThan(
      mocks.steps.indexOf('actor')
    )
    // The default rule did not run, so the blank key reaches the save.
    expect(mocks.apply).toHaveBeenCalledWith(mocks.tx, {
      settings: storage(),
    })
  })
})
