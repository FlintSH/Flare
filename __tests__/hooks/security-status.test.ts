import { describe, expect, it } from 'vitest'

import { accountKey } from '@/hooks/use-account-query'
import { sameAccountStatus } from '@/hooks/use-security-status'

const scope = (userId: string, sessionId: string) => ({
  userId,
  sessionId,
  key: JSON.stringify([userId, sessionId]),
})
const queryOf = (userId: string, sessionId: string) => ({
  queryKey: accountKey(
    'account-security',
    scope(userId, sessionId),
    '/api/auth/security'
  ),
})
const status = { twoFactorEnabled: true }

describe('security status across a confirmation in place', () => {
  it('keeps the status of the same account while its new session loads', () => {
    expect(
      sameAccountStatus('alex')(status, queryOf('alex', 'session-before'))
    ).toBe(status)
  })

  it('never shows the status of a different account', () => {
    expect(
      sameAccountStatus('jamie')(status, queryOf('alex', 'session-before'))
    ).toBeUndefined()
  })

  it('shows nothing without a session or without an earlier read', () => {
    expect(
      sameAccountStatus(undefined)(status, queryOf('alex', 'session-before'))
    ).toBeUndefined()
    expect(sameAccountStatus('alex')(status, undefined)).toBeUndefined()
    expect(
      sameAccountStatus(undefined)(status, {
        queryKey: accountKey('account-security', null, '/api/auth/security'),
      })
    ).toBeUndefined()
  })
})
