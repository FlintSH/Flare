import CustomizePage from '@/app/(main)/dashboard/customize/page'
import IntegrationsPage from '@/app/(main)/dashboard/integrations/page'
import ProfilePage from '@/app/(main)/dashboard/profile/page'
import SettingsPage from '@/app/(main)/dashboard/settings/page'
import UploadProfilesPage from '@/app/(main)/dashboard/upload-profiles/page'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  config: vi.fn(),
  recovery: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth/page-session', () => ({ getPageSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findUnique: mocks.user } },
}))
vi.mock('@/lib/config', () => ({ getConfig: mocks.config }))
vi.mock('@/lib/customization/recovery', () => ({
  isAppearanceRecovery: mocks.recovery,
}))
vi.mock('@/lib/email/config', () => ({
  redactEmailConfig: () => ({ redacted: true }),
}))
vi.mock('@/components/settings/instance-settings', () => ({
  InstanceSettings: () => null,
}))
vi.mock('@/components/profile', () => ({ ProfileClient: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({
    user: { id: 'operator', permissions: ['administrator'], roles: [] },
  })
  mocks.user.mockResolvedValue({})
})

describe('settings permission and legacy navigation', () => {
  it('does not read instance settings for a signed-out visitor', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(
      SettingsPage({ searchParams: Promise.resolve({ section: 'appearance' }) })
    ).rejects.toThrow('redirect:/auth/login')
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.recovery).not.toHaveBeenCalled()
  })

  it.each([{ permissions: [] }, { permissions: ['files.upload'] }])(
    'requires settings.read from the current session before reading private configuration: %j',
    async (user) => {
      mocks.session.mockResolvedValue({ user: { id: 'operator', ...user } })
      await expect(
        SettingsPage({
          searchParams: Promise.resolve({ section: 'appearance' }),
        })
      ).rejects.toThrow('redirect:/dashboard/profile')
      expect(mocks.config).not.toHaveBeenCalled()
      expect(mocks.recovery).not.toHaveBeenCalled()
    }
  )

  it('sends a former administrator to personal appearance without recovery', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'operator', permissions: [] },
    })
    await expect(
      CustomizePage({ searchParams: Promise.resolve({ recovery: '1' }) })
    ).rejects.toThrow(
      'redirect:/dashboard/profile?section=account#workspace-appearance'
    )
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it.each([
    ['appearance', 'appearance'],
    ['advanced', 'appearance'],
    ['about', 'general'],
    ['access', 'access'],
    ['https://untrusted.example', 'general'],
    ['appearance&recovery=1', 'general'],
    [['appearance', 'advanced'], 'general'],
  ])(
    'loads an authorized section without exposing email credentials: %s',
    async (section, expected) => {
      mocks.config.mockResolvedValue({
        settings: {
          email: { password: 'private-mail-password' },
          general: {
            oidc: { clientSecret: 'private-oidc-secret' },
            storage: {
              s3: {
                secretAccessKey: 'private-s3-secret',
                accessKeyId: 'private-s3-key',
              },
            },
          },
        },
      })
      mocks.recovery.mockResolvedValue(false)
      const page = await SettingsPage({
        searchParams: Promise.resolve({ section }),
      })
      expect(page.props.initialSection).toBe(expected)
      expect(page.props.initialConfig.settings.email).toEqual({
        redacted: true,
      })
      expect(JSON.stringify(page.props)).not.toContain('private-mail-password')
      expect(JSON.stringify(page.props)).not.toContain('private-oidc-secret')
      expect(JSON.stringify(page.props)).not.toContain('private-s3-secret')
      expect(JSON.stringify(page.props)).not.toContain('private-s3-key')
    }
  )

  it.each([
    ['1', '&recovery=1'],
    ['true', ''],
    ['1&section=advanced', ''],
    [undefined, ''],
  ])(
    'preserves only the explicit admin recovery flag: %s',
    async (recovery, suffix) => {
      await expect(
        CustomizePage({ searchParams: Promise.resolve({ recovery }) })
      ).rejects.toThrow(
        `redirect:/dashboard/settings?section=appearance${suffix}`
      )
    }
  )

  it('preserves existing upload-profile and integration links', async () => {
    await expect(UploadProfilesPage()).rejects.toThrow(
      'redirect:/dashboard/profile?section=uploads'
    )
    await expect(IntegrationsPage()).rejects.toThrow(
      'redirect:/dashboard/profile?section=integrations'
    )
  })

  it('requires sign-in before redirecting old personal configuration pages', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(UploadProfilesPage()).rejects.toThrow('redirect:/auth/login')
    await expect(IntegrationsPage()).rejects.toThrow('redirect:/auth/login')
  })
})

describe('profile section compatibility', () => {
  it.each([
    ['account', 'account'],
    ['appearance', 'account'],
    ['security', 'account'],
    ['uploads', 'uploads'],
    ['integrations', 'integrations'],
    ['data', 'data'],
    ['advanced', 'account'],
    [['appearance', 'uploads'], 'account'],
  ])('loads the canonical section for %s', async (section, expected) => {
    mocks.user.mockResolvedValue({
      id: 'operator',
      storageUsed: 0,
      preferences: {},
      _count: { files: 0, shortenedUrls: 0 },
    })
    mocks.config.mockResolvedValue({
      settings: {
        general: {
          storage: {
            quotas: { enabled: false, default: { value: 1, unit: 'GB' } },
          },
        },
      },
    })
    const page = await ProfilePage({
      searchParams: Promise.resolve({ section }),
    })
    expect(page.props.initialSection).toBe(expected)
  })

  it('still requires sign-in before loading an aliased section', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(
      ProfilePage({ searchParams: Promise.resolve({ section: 'security' }) })
    ).rejects.toThrow('redirect:/auth/login')
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled()
  })
})
