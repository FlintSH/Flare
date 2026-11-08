import type { ReactElement, ReactNode } from 'react'

import { signOut } from 'next-auth/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountEmail } from '@/components/email/account-email'
import { ProfileDeleteAccount } from '@/components/profile/profile-delete-account'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { AccountEmailStatus } from '@/lib/email/eligibility'

import { useSignOut } from '@/hooks/use-sign-out'

// Keeps component state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  toast: vi.fn(),
  effects: [] as Array<() => void>,
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
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: (effect: () => void) => {
    harness.effects.push(effect)
  },
  useId: () => 'delete-account-confirmation',
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
  harness.effects = []
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
  harness.effects = []
  harness.cursor = 0
  return ProfileDeleteAccount()
}

const confirmButton = () =>
  find(render(), (element) => element.type === AlertDialogAction)!

function typeIntent(value: string) {
  const input = find(render(), (element) => element.type === Input)!
  ;(input.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  })
}

/** Chooses Delete account permanently and waits until it can be chosen again. */
async function deleteAccount() {
  typeIntent('DELETE')
  ;(
    confirmButton().props.onClick as (event: { preventDefault(): void }) => void
  )({
    preventDefault() {},
  })
  await vi.waitFor(() => expect(confirmButton().props.disabled).toBe(false))
}

const shownError = () =>
  find(render(), (element) => element.props.role === 'alert')?.props.children

describe('deleting your account', () => {
  it('requires the exact typed intent before any deletion request, including a direct handler call', async () => {
    for (const value of ['', 'delete', 'DELETE ', ' DELETE', 'DELET']) {
      typeIntent(value)
      expect(confirmButton().props.disabled).toBe(true)
      ;(
        confirmButton().props.onClick as (event: {
          preventDefault(): void
        }) => void
      )({
        preventDefault() {},
      })
      await Promise.resolve()
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    typeIntent('DELETE')
    expect(confirmButton().props.disabled).toBe(false)
  })

  it('clears the typed intent and refusal when the dialog closes and reopens', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Deletion refused' }, { status: 409 })
    )
    await deleteAccount()
    expect(shownError()).toBe('Deletion refused')
    expect(confirmButton().props.disabled).toBe(false)
    const close = () =>
      find(render(), (element) => element.type === AlertDialog)!
    ;(close().props.onOpenChange as (open: boolean) => void)(false)
    expect(shownError()).toBeUndefined()
    expect(confirmButton().props.disabled).toBe(true)
    ;(close().props.onOpenChange as (open: boolean) => void)(true)
    expect(
      find(render(), (element) => element.type === Input)!.props.value
    ).toBe('')
    expect(confirmButton().props.disabled).toBe(true)
  })

  it('keeps the confirmed intent available to retry a refused request', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ error: 'Try again later' }, { status: 503 })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteAccount()
    expect(shownError()).toBe('Try again later')
    expect(signOut).not.toHaveBeenCalled()
    expect(
      find(render(), (element) => element.type === Input)!.props.value
    ).toBe('DELETE')
    ;(
      confirmButton().props.onClick as (event: {
        preventDefault(): void
      }) => void
    )({ preventDefault() {} })
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith(localSignIn))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shownError()).toBeUndefined()
  })

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
    expect(
      find(render(), (element) => element.type === AlertDialogTitle)!.props
        .children
    ).toBe('Your account has been deleted')
    expect(find(render(), (element) => element.type === Input)).toBeUndefined()
    expect(
      find(render(), (element) => element.type === AlertDialogCancel)
    ).toBeUndefined()
    expect(confirmButton().props.children).toContain('Try signing out again')
    expect(harness.toast).not.toHaveBeenCalled()
  })

  it('focuses and reveals sign-out recovery after each failure and keeps it open on Escape', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.mocked(signOut).mockRejectedValue(new TypeError('Failed to fetch'))
    await deleteAccount()
    const focus = vi.fn()
    const scrollIntoView = vi.fn()
    const view = render()
    const action = find(view, (element) => element.type === AlertDialogAction)!
    const ref = action.props.ref as { current: unknown }
    ref.current = { focus, scrollIntoView }
    for (const effect of harness.effects) effect()
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })

    const escape = vi.fn()
    const content = find(
      view,
      (element) => element.type === AlertDialogContent
    )!
    ;(
      content.props.onEscapeKeyDown as (event: {
        preventDefault(): void
      }) => void
    )({ preventDefault: escape })
    expect(escape).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
    expect(
      find(render(), (element) => element.type === AlertDialogCancel)
    ).toBeUndefined()

    ;(
      confirmButton().props.onClick as (event: {
        preventDefault(): void
      }) => void
    )({ preventDefault() {} })
    await vi.waitFor(() => expect(confirmButton().props.disabled).toBe(false))
    render()
    for (const effect of harness.effects) effect()
    expect(focus).toHaveBeenCalledTimes(3)
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledTimes(2)
    expect(shownError()).toBe('Failed to fetch')
  })

  it('prevents Escape while deleting, without moving focus to the disabled action', async () => {
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    typeIntent('DELETE')
    ;(
      confirmButton().props.onClick as (event: {
        preventDefault(): void
      }) => void
    )({ preventDefault() {} })
    const view = render()
    const focus = vi.fn()
    const scrollIntoView = vi.fn()
    const action = find(view, (element) => element.type === AlertDialogAction)!
    ;(action.props.ref as { current: unknown }).current = {
      focus,
      scrollIntoView,
    }
    expect(action.props.disabled).toBe(true)
    for (const effect of harness.effects) effect()
    const escape = vi.fn()
    ;(
      find(view, (element) => element.type === AlertDialogContent)!.props
        .onEscapeKeyDown as (event: { preventDefault(): void }) => void
    )({ preventDefault: escape })
    expect(escape).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    finish(new Response(null, { status: 204 }))
    await vi.waitFor(() => expect(confirmButton().props.disabled).toBe(false))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('leaves the existing pre-deletion Escape path available', () => {
    typeIntent('DELETE')
    const view = render()
    const escape = vi.fn()
    ;(
      find(view, (element) => element.type === AlertDialogContent)!.props
        .onEscapeKeyDown as (event: { preventDefault(): void }) => void
    )({ preventDefault: escape })
    expect(escape).not.toHaveBeenCalled()
    ;(
      find(view, (element) => element.type === AlertDialog)!.props
        .onOpenChange as (open: boolean) => void
    )(false)
    expect(confirmButton().props.disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('retries only sign-out after successful deletion and keeps the deleted state', async () => {
    const dialog = () =>
      find(render(), (element) => element.type === AlertDialog)!
    ;(dialog().props.onOpenChange as (open: boolean) => void)(true)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.mocked(signOut).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await deleteAccount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(shownError()).toBe('Failed to fetch')
    ;(dialog().props.onOpenChange as (open: boolean) => void)(false)
    expect(dialog().props.open).toBe(true)
    ;(
      confirmButton().props.onClick as (event: {
        preventDefault(): void
      }) => void
    )({ preventDefault() {} })
    await vi.waitFor(() => expect(confirmButton().props.disabled).toBe(false))
    expect(signOut).toHaveBeenCalledTimes(2)
    expect(signOut).toHaveBeenLastCalledWith(localSignIn)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/profile',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(shownError()).toBeUndefined()
    expect(
      find(render(), (element) => element.type === AlertDialogTitle)!.props
        .children
    ).toBe('Your account has been deleted')
    expect(
      find(render(), (element) => element.type === AlertDialogCancel)
    ).toBeUndefined()
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
  canRequestChange: false,
  verifyBy: null,
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
