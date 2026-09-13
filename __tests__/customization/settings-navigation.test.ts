import CustomizePage from '@/app/(main)/dashboard/customize/page'
import IntegrationsPage from '@/app/(main)/dashboard/integrations/page'
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'operator', role: 'ADMIN' } })
  mocks.user.mockResolvedValue({ role: 'ADMIN' })
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

  it.each([{ role: 'USER' }, null])(
    'rechecks the current role before reading private configuration: %j',
    async (user) => {
      mocks.user.mockResolvedValue(user)
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
    mocks.user.mockResolvedValue({ role: 'USER' })
    await expect(
      CustomizePage({ searchParams: Promise.resolve({ recovery: '1' }) })
    ).rejects.toThrow('redirect:/dashboard/profile?section=appearance')
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it.each([
    ['appearance', 'appearance'],
    ['https://untrusted.example', 'general'],
    ['appearance&recovery=1', 'general'],
  ])(
    'loads an authorized section without exposing email credentials: %s',
    async (section, expected) => {
      mocks.config.mockResolvedValue({
        settings: { email: { password: 'private-mail-password' } },
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
