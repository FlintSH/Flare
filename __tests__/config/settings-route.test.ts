import { POST } from '@/app/api/settings/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

import { ConfigValidationError, DEFAULT_CONFIG } from '@/lib/config'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  session: vi.fn(),
  saved: [] as unknown[],
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  applyConfigUpdate: mocks.apply,
}))
// A database with no settings saved yet; its transaction records what is saved.
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: (run: (tx: object) => unknown) =>
      run({
        config: {
          findUnique: async () => null,
          upsert: async ({ update }: { update: { value: unknown } }) => {
            mocks.saved.push(update.value)
          },
        },
      }),
  },
}))
vi.mock('@/lib/database/locks', () => ({
  lockRoleChanges: vi.fn(),
  lockSettings: vi.fn(),
}))
vi.mock('@/lib/permissions/server', () => ({
  PermissionError: class extends Error {},
  assertAccessibleAdministrator: vi.fn(),
  getUserAccess: vi.fn(),
  requireActorPermission: vi.fn(),
}))

const post = (body: unknown) =>
  POST(
    new Request('https://flare.test/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saved.length = 0
  mocks.apply.mockResolvedValue({})
  mocks.session.mockResolvedValue({
    user: { id: 'admin', permissions: ['administrator'] },
  })
})

describe('POST /api/settings', () => {
  it.each([
    ['no settings', {}],
    ['settings without advanced', { settings: { general: {} } }],
    [
      'a custom CSS that is not text',
      { settings: { advanced: { customCSS: 4 } } },
    ],
    ['a body that is not an object', [1, 2]],
  ])('answers %s with 400 before saving', async (_case, body) => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Could not update settings. Check the values and try again.',
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('answers settings the schema rejects on save with 400', async () => {
    mocks.apply.mockRejectedValue(new ConfigValidationError())
    const response = await post({ settings: { advanced: {} } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Could not update settings. Check the values and try again.',
    })
  })

  it('answers saved settings it cannot read with a logged 500', async () => {
    const logged = vi
      .spyOn(loggers.config, 'error')
      .mockImplementation(() => {})
    mocks.apply.mockRejectedValue(
      new ZodError([
        { code: 'custom', message: 'Bad port', path: ['settings'], input: 0 },
      ])
    )
    const response = await post({ settings: { advanced: {} } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Internal server error',
    })
    expect(logged).toHaveBeenCalledOnce()
  })

  it('saves the whole document without the Email tab and appearance studio sections', async () => {
    const { applyConfigUpdate } =
      await vi.importActual<typeof import('@/lib/config')>('@/lib/config')
    mocks.apply.mockImplementation(applyConfigUpdate)
    const response = await post({
      settings: {
        advanced: { customCSS: 'body {}' },
        email: { enabled: true },
        customization: { revision: 5 },
      },
    })
    expect(response.status).toBe(200)
    const [saved] = mocks.saved as (typeof DEFAULT_CONFIG)[]
    expect(saved.settings.advanced.customCSS).toBe('body {}')
    expect(saved.settings.email).toEqual(DEFAULT_CONFIG.settings.email)
    expect(saved.settings.customization).toEqual(
      DEFAULT_CONFIG.settings.customization
    )
  })
})
