import { type ComponentType, createElement } from 'react'

import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  QueryObserver,
  useQueryClient,
} from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditLog } from '@/components/audit/audit-log'
import { ProfileSessions } from '@/components/profile/security/profile-sessions'
import { SignInSecurity } from '@/components/profile/security/sign-in-security'
import { QueryProvider } from '@/components/providers/query-provider'

import { useSecurityStatus } from '@/hooks/use-security-status'

const auth = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'loading' | 'unauthenticated',
  data: null as {
    user: {
      id: string
      name: string
      sessionId: string
      permissions?: string[]
    }
  } | null,
}))
vi.mock('next-auth/react', () => ({
  useSession: () => auth,
  signOut: vi.fn(),
}))

let client: QueryClient
type Keys = { sessions: QueryKey; history: QueryKey }

function authenticate(id: string, sessionId = `${id}-browser`) {
  auth.status = 'authenticated'
  auth.data = { user: { id, name: id, sessionId } }
}

function render(Component: ComponentType = ProfileSessions) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Component))
  )
}

function latestKeys(): Keys {
  const queries = client.getQueryCache().getAll()
  const sessions = queries
    .filter((query) => query.queryKey[0] === 'profile-sessions')
    .at(-1)
  const history = queries
    .filter((query) => query.queryKey[0] === 'profile-login-history')
    .at(-1)
  expect(sessions).toBeDefined()
  expect(history).toBeDefined()
  return { sessions: sessions!.queryKey, history: history!.queryKey }
}

function seed(keys: Keys, owner: 'alice' | 'bob') {
  const timestamp = '2026-10-06T12:00:00.000Z'
  client.setQueryData(keys.sessions, {
    sessions: [
      {
        id: `${owner}-session-secret`,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        expiresAt: '2026-11-05T12:00:00.000Z',
        authMethod: 'credentials',
        ipAddress: owner === 'alice' ? '192.0.2.11' : '192.0.2.22',
        userAgent: `${owner}-private-user-agent Chrome/130 Linux`,
        current: true,
      },
    ],
  })
  client.setQueryData(keys.history, {
    pages: [
      {
        attempts: [
          {
            id: `${owner}-login-secret`,
            createdAt: timestamp,
            authMethod: 'credentials',
            outcome: 'success',
            ipAddress: owner === 'alice' ? '198.51.100.11' : '198.51.100.22',
            userAgent: `${owner}-history-user-agent`,
          },
        ],
        nextCursor: `${owner}-private-history-cursor`,
      },
    ],
    pageParams: [''],
  })
}

function expectAbsent(html: string, owner: 'alice' | 'bob') {
  for (const text of [
    `${owner}-private-user-agent`,
    `${owner}-history-user-agent`,
    owner === 'alice' ? '192.0.2.11' : '192.0.2.22',
    owner === 'alice' ? '198.51.100.11' : '198.51.100.22',
  ])
    expect(html).not.toContain(text)
}

beforeEach(() => {
  // Use the production provider's actual cache defaults, then retain that same
  // client across renders as the root layout does during client-side navigation.
  function CaptureClient() {
    client = useQueryClient()
    return null
  }
  renderToStaticMarkup(
    createElement(QueryProvider, null, createElement(CaptureClient))
  )
  expect(client.getDefaultOptions().queries?.staleTime).toBe(5 * 60 * 1000)
  authenticate('alice')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
})

describe('profile activity query ownership', () => {
  it('does not render the prior account’s fresh sessions or paginated login history after a same-tab account switch', () => {
    render()
    const alice = latestKeys()
    seed(alice, 'alice')
    const aliceMarkup = render()
    expect(aliceMarkup).toContain('alice-private-user-agent')
    expect(aliceMarkup).toContain('198.51.100.11')
    expect(aliceMarkup).toContain('Load more attempts')

    authenticate('bob')
    const bobLoading = render()
    expectAbsent(bobLoading, 'alice')
    expect(bobLoading).not.toContain('Load more attempts')
    const bob = latestKeys()
    expect(bob.sessions).not.toEqual(alice.sessions)
    expect(bob.history).not.toEqual(alice.history)
    expect(client.getQueryData(bob.history)).toBeUndefined()
    seed(bob, 'bob')
    const bobMarkup = render()
    expect(bobMarkup).toContain('bob-private-user-agent')
    expect(bobMarkup).toContain('198.51.100.22')
    expectAbsent(bobMarkup, 'alice')
  })

  it.each(['loading', 'unauthenticated'] as const)(
    'hides cached activity while authentication is %s even if stale user data remains',
    (status) => {
      render()
      seed(latestKeys(), 'alice')
      auth.status = status
      const html = render()
      expectAbsent(html, 'alice')
      expect(html).not.toContain('Revoke session')
      expect(html).not.toContain('Load more attempts')
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('does not inherit current-session markers after the same account signs in with a new browser session', () => {
    render()
    const firstSession = latestKeys()
    seed(firstSession, 'alice')
    authenticate('alice', 'replacement-browser-session')
    const html = render()
    expectAbsent(html, 'alice')
    expect(html).not.toContain('This browser')
    expect(latestKeys().sessions).not.toEqual(firstSession.sessions)
  })

  it('ignores legacy unscoped cache entries left by an earlier application revision', () => {
    seed(
      {
        sessions: ['profile-sessions'],
        history: ['profile-login-history', 'all'],
      },
      'alice'
    )
    authenticate('bob')
    const html = render()
    expectAbsent(html, 'alice')
    expect(html).not.toContain('Load more attempts')
  })
})

function latestSecurityKey() {
  const query = client
    .getQueryCache()
    .getAll()
    .filter((entry) => entry.queryKey[0] === 'account-security')
    .at(-1)
  expect(query).toBeDefined()
  return query!.queryKey
}

function seedSecurity(key: QueryKey, owner: string) {
  client.setQueryData(key, {
    twoFactorEnabled: true,
    recoveryCodesRemaining: 7,
    hasPassword: true,
    passkeys: [
      {
        id: `${owner}-passkey-id`,
        name: `${owner}-private-passkey-name`,
        createdAt: '2026-10-06T12:00:00.000Z',
        lastUsedAt: null,
      },
    ],
    canUseRecentPasskey: false,
    canUseRecentRecovery: false,
    canUseRecentPasskeyRecovery: false,
    canUseRecentSso: false,
    passkeysAvailable: true,
    passkeyRequired: false,
    passkeyRecoveryCodesRemaining: 0,
  })
}

describe('adjacent sign-in security query ownership', () => {
  it('keeps passkey names and security status scoped to both account and current browser session', () => {
    render(SignInSecurity)
    const alice = latestSecurityKey()
    seedSecurity(alice, 'alice')
    expect(render(SignInSecurity)).toContain('alice-private-passkey-name')
    authenticate('bob')
    expect(render(SignInSecurity)).not.toContain('alice-private-passkey-name')
    const bob = latestSecurityKey()
    expect(bob).not.toEqual(alice)
    seedSecurity(bob, 'bob')
    expect(render(SignInSecurity)).toContain('bob-private-passkey-name')
    authenticate('bob', 'replacement-browser-session')
    expect(render(SignInSecurity)).not.toContain('bob-private-passkey-name')
    expect(latestSecurityKey()).not.toEqual(bob)
  })

  it.each(['loading', 'unauthenticated'] as const)(
    'hides sign-in controls and hook data during %s, even with a populated account cache',
    (status) => {
      render(SignInSecurity)
      seedSecurity(latestSecurityKey(), 'alice')
      auth.status = status
      expect(render(SignInSecurity)).toBe('')
      let security: ReturnType<typeof useSecurityStatus> | undefined
      function DirectStatusConsumer() {
        security = useSecurityStatus()
        return null
      }
      render(DirectStatusConsumer)
      expect(security?.data).toBeUndefined()
      const query = client.getQueryCache().find({
        queryKey: latestSecurityKey(),
        exact: true,
      })!
      const observer = new QueryObserver(client, {
        ...query.options,
        queryKey: query.queryKey,
      })
      expect(observer.options.enabled).toBe(false)
    }
  )

  it('ignores legacy unscoped security status retained by the root query provider', () => {
    seedSecurity(['account-security'], 'alice')
    authenticate('bob')
    expect(render(SignInSecurity)).not.toContain('alice-private-passkey-name')
  })
})

describe('private account query lifetime', () => {
  it.each([
    ['profile-sessions', ProfileSessions, '/api/profile/sessions'],
    [
      'profile-login-history',
      ProfileSessions,
      '/api/profile/login-history?outcome=all',
    ],
    ['account-security', SignInSecurity, '/api/auth/security'],
  ] as const)(
    'cancels the %s network read when its last account observer unmounts',
    async (prefix, Component, path) => {
      render(Component)
      const query = client
        .getQueryCache()
        .getAll()
        .find((entry) => entry.queryKey[0] === prefix)!
      let signal: AbortSignal | undefined
      vi.mocked(fetch).mockImplementation((_url, options) => {
        signal = options?.signal ?? undefined
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
      })
      const observer = new QueryObserver(client, {
        ...query.options,
        queryKey: query.queryKey,
      })
      const unsubscribe = observer.subscribe(() => {})
      await Promise.resolve()
      expect(fetch).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          cache: 'no-store',
          signal: expect.any(AbortSignal),
        })
      )
      expect(signal?.aborted).toBe(false)
      expect(query.options.gcTime).toBe(0)
      expect(observer.options.staleTime).toBe(0)
      unsubscribe()
      expect(signal?.aborted).toBe(true)
    }
  )
})

describe('administrator audit account boundary', () => {
  it('does not mount the audit viewer for a new account without audit.read', () => {
    auth.data!.user.permissions = ['audit.read']
    expect(render(AuditLog)).toContain('Audit events')
    authenticate('bob')
    auth.data!.user.permissions = ['files.read']
    expect(render(AuditLog)).toBe('')
  })

  it.each(['loading', 'unauthenticated'] as const)(
    'hides the audit viewer during %s even if prior administrator details remain',
    (status) => {
      auth.data!.user.permissions = ['administrator']
      auth.status = status
      expect(render(AuditLog)).toBe('')
    }
  )
})
