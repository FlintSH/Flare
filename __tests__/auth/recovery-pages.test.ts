import { createElement } from 'react'

import ForgotPasswordPage from '@/app/(main)/auth/forgot-password/page'
import ResetPasswordPage from '@/app/(main)/auth/reset-password/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  reset: vi.fn(),
  forgot: vi.fn(),
}))
vi.mock('@/lib/email/config', () => ({
  getEmailCapabilities: mocks.capabilities,
}))
vi.mock('@/components/email/auth-forms', () => ({
  ResetPasswordForm: (props: { recoveryEnabled: boolean | null }) => {
    mocks.reset(props.recoveryEnabled)
    return createElement('span', null, 'Reset form')
  },
  ForgotPasswordForm: (props: { recoveryEnabled: boolean | null }) => {
    mocks.forgot(props.recoveryEnabled)
    return createElement('span', null, 'Request form')
  },
}))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => null,
}))
vi.mock('@/components/layout/dynamic-background', () => ({
  DynamicBackground: () => null,
}))

const reset = async (token?: string) =>
  renderToStaticMarkup(
    await ResetPasswordPage({ searchParams: Promise.resolve({ token }) })
  )
beforeEach(() => {
  vi.clearAllMocks()
  mocks.capabilities.mockResolvedValue({ recoveryEnabled: true })
})

describe('password-recovery page next steps', () => {
  it('offers a new link for an incomplete token only when recovery is known enabled', async () => {
    const page = await reset()
    expect(page).toContain('This reset link is incomplete')
    expect(page).toContain('Request a new link')
    expect(page).toContain('href="/auth/forgot-password"')
    expect(mocks.reset).not.toHaveBeenCalled()
  })

  it('offers sign-in and concrete account-manager guidance when recovery is disabled', async () => {
    mocks.capabilities.mockResolvedValue({ recoveryEnabled: false })
    const page = await reset()
    expect(page).toContain('provided or manages your account')
    expect(page).toContain('Email password recovery is not enabled')
    expect(page).toContain(`href="${LOCAL_SIGN_IN_PATH}"`)
    expect(page).not.toContain('Request a new link')
    expect(page).not.toContain('/auth/forgot-password')
    const forgot = renderToStaticMarkup(await ForgotPasswordPage())
    expect(forgot).toContain('provided or manages your account')
    expect(mocks.forgot).not.toHaveBeenCalled()
  })

  it('does not promise recovery or declare it disabled when availability cannot be read', async () => {
    mocks.capabilities.mockRejectedValue(
      new Error('Temporary configuration failure')
    )
    const page = await reset()
    expect(page).toContain('Recovery availability could not be checked')
    expect(page).toContain('Check recovery options')
    expect(page).not.toContain('Request a new link')
    expect(page).not.toContain('not enabled on this instance')
    renderToStaticMarkup(await ForgotPasswordPage())
    expect(mocks.forgot).toHaveBeenCalledWith(null)
  })

  it.each([true, false, null])(
    'passes the current policy answer %s to a token-present client form',
    async (enabled) => {
      if (enabled === null)
        mocks.capabilities.mockRejectedValue(new Error('Unavailable'))
      else mocks.capabilities.mockResolvedValue({ recoveryEnabled: enabled })
      expect(await reset('public-disposable-test-token')).toContain(
        'Reset form'
      )
      expect(mocks.reset).toHaveBeenCalledWith(enabled)
      expect(mocks.capabilities).toHaveBeenCalledTimes(1)
    }
  )
})
