import type { ReactElement, ReactNode } from 'react'

import { signOut } from 'next-auth/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountEmail } from '@/components/email/account-email'
import type { AccountEmailStatus } from '@/components/email/api'
import { ProfileDeleteAccount } from '@/components/profile/profile-delete-account'
import { AlertDialogAction } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import { useSignOut } from '@/hooks/use-sign-out'

// Keeps component state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  toast: vi.fn(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (next: unknown) => {
        harness.slots[index] =
          typeof next === 'function' ? next(harness.slots[index]) : next
      },
    ]
  },
  useEffect: () => {},
}))
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-security-status', () => ({
  useSecurityStatus: () => ({ data: undefined, refetch: vi.fn() }),
}))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: harness.toast }),
}))

const fetchMock = vi.fn<typeof fetch>()
const localSignIn = { callbackUrl: '/auth/login?local=1' }

beforeEach(() => {
  harness.slots = []
  harness.toast.mockReset()
  vi.mocked(signOut).mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSignOut', () => {
  it('lands on the local sign-in form, which never redirects to SSO', async () => {
    await useSignOut()()
    expect(signOut).toHaveBeenCalledWith(localSignIn)
    expect(harness.toast).not.toHaveBeenCalled()
  })

  it('reports a failed sign-out with a toast by default', async () => {
    vi.mocked(signOut).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    await useSignOut()()
    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to logout',
      variant: 'destructive',
    })
  })

  it('lets the caller report a failed sign-out its own way', async () => {
    const failure = new TypeError('Failed to fetch')
    const onError = vi.fn()
    vi.mocked(signOut).mockRejectedValueOnce(failure)
    await useSignOut({ onError })()
    expect(onError).toHaveBeenCalledWith(failure)
    expect(harness.toast).not.toHaveBeenCalled()
  })
})

function find(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, matches)
      if (found) return found
    }
    return undefined
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined
  const element = node as ReactElement<Record<string, unknown>>
  if (matches(element)) return element
  return find(element.props.children as ReactNode, matches)
}

function render() {
  harness.cursor = 0
  return ProfileDeleteAccount()
}

/** Chooses Delete account permanently and waits for the dialog to settle. */
async function deleteAccount() {
  const confirm = find(
    render(),
    (element) => element.type === AlertDialogAction
  )
  ;(confirm!.props.onClick as (event: { preventDefault(): void }) => void)({
    preventDefault() {},
  })
  await vi.waitFor(() => expect(harness.slots[0]).toBe(false))
}

const shownError = () =>
  find(render(), (element) => element.props.role === 'alert')?.props.children

describe('deleting your account', () => {
  it('signs out to the local sign-in form, so SSO cannot provision the account again', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteAccount()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(signOut).toHaveBeenCalledWith(localSignIn)
    expect(shownError()).toBeUndefined()
  })

  it('keeps the dialog open with the server’s reason when deletion is refused', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          success: false,
          error:
            'Keep at least one administrator who can sign in and meets the email access policy',
        },
        { status: 409 }
      )
    )
    await deleteAccount()
    expect(signOut).not.toHaveBeenCalled()
    expect(shownError()).toBe(
      'Keep at least one administrator who can sign in and meets the email access policy'
    )
  })

  it('shows a failed sign-out in the dialog after the account is gone', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.mocked(signOut).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await deleteAccount()
    expect(shownError()).toBe('Failed to fetch')
    expect(harness.toast).not.toHaveBeenCalled()
  })
})

const unverified: AccountEmailStatus = {
  enabled: true,
  recoveryEnabled: true,
  verificationMode: 'all_users',
  verified: false,
  exempt: false,
  required: true,
  pendingEmail: null,
  canChangeEmail: false,
  canEnroll: false,
  canResend: true,
  hasPassword: true,
  requiresPassword: false,
  requiresOldEmail: false,
  resendSeconds: 60,
  graceEndsAt: null,
}

describe('signing out from the email verification page', () => {
  it('lands on the local sign-in form, so SSO auto-login cannot sign the account straight back in', async () => {
    harness.cursor = 0
    const view = AccountEmail({
      status: unverified,
      refresh: async () => {},
      restricted: true,
    })
    const button = find(
      view,
      (element) =>
        element.type === Button && element.props.children === 'Sign out'
    )
    await (button!.props.onClick as () => Promise<void>)()
    expect(signOut).toHaveBeenCalledWith(localSignIn)
  })
})
