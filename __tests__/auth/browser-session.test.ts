import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findBrowserSession, validateBrowserSession } from '@/lib/auth/sessions'

const db = vi.hoisted(() => ({
  browserSession: { findFirst: vi.fn(), updateMany: vi.fn() },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: db }))

const now = new Date('2026-11-12T12:00:00.000Z')
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000)
/** A signed-in browser session, last seen this long ago. */
const session = (lastSeenSecondsAgo = 5) => ({
  id: 'browser-1',
  userId: 'owner',
  sessionVersion: 2,
  authMethod: 'credentials',
  ipAddress: null,
  userAgent: null,
  createdAt: secondsAgo(3600),
  lastSeenAt: secondsAgo(lastSeenSecondsAgo),
  expiresAt: new Date(now.getTime() + 86_400_000),
  revokedAt: null,
})
const signedIn = {
  id: 'browser-1',
  userId: 'owner',
  sessionVersion: 2,
  revokedAt: null,
  expiresAt: { gt: now },
}
const revoked = {
  status: 401,
  message: 'Session invalidated: Session revoked or expired',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  db.browserSession.findFirst.mockResolvedValue(session())
  db.browserSession.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('finding a browser session', () => {
  it('finds only a session of this account and version that is neither revoked nor expired', async () => {
    expect(await findBrowserSession('owner', 'browser-1', 2)).toEqual(session())
    expect(db.browserSession.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: signedIn,
    })
  })

  it('answers null without asking the database when the token names no session', async () => {
    expect(await findBrowserSession('owner', undefined, 2)).toBeNull()
    expect(db.browserSession.findFirst).not.toHaveBeenCalled()
  })
})

describe('validating a browser session', () => {
  it('reads the session itself when the caller has not', async () => {
    expect(await validateBrowserSession('owner', 'browser-1', 2)).toEqual(
      session()
    )
    expect(db.browserSession.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: signedIn,
    })
  })

  it('uses the session the caller already read, without reading it again', async () => {
    const found = session()
    expect(await validateBrowserSession('owner', 'browser-1', 2, found)).toBe(
      found
    )
    expect(db.browserSession.findFirst).not.toHaveBeenCalled()
  })

  it('refuses when the caller looked and found no session, without looking again', async () => {
    await expect(
      validateBrowserSession('owner', 'browser-1', 2, null)
    ).rejects.toMatchObject(revoked)
    expect(db.browserSession.findFirst).not.toHaveBeenCalled()
    expect(db.browserSession.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a session it cannot find itself', async () => {
    db.browserSession.findFirst.mockResolvedValue(null)
    await expect(
      validateBrowserSession('owner', 'browser-1', 2)
    ).rejects.toMatchObject(revoked)
    expect(db.browserSession.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['nothing else', [] as const],
    ['no session', [null] as const],
    ['a session', [session()] as const],
  ])(
    'refuses a token that names no session, given %s',
    async (_case, found) => {
      await expect(
        validateBrowserSession('owner', undefined, 2, ...found)
      ).rejects.toMatchObject({
        status: 401,
        message: 'Session invalidated: Sign in again after upgrading.',
      })
      expect(db.browserSession.findFirst).not.toHaveBeenCalled()
      expect(db.browserSession.updateMany).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['it read itself', false],
    ['the caller read', true],
  ])(
    'notes the activity of a session %s at most once a minute',
    async (_case, preRead) => {
      const validate = (lastSeenSecondsAgo: number) => {
        const found = session(lastSeenSecondsAgo)
        db.browserSession.findFirst.mockResolvedValue(found)
        return preRead
          ? validateBrowserSession('owner', 'browser-1', 2, found)
          : validateBrowserSession('owner', 'browser-1', 2)
      }
      await validate(0)
      await validate(59.999)
      expect(db.browserSession.updateMany).not.toHaveBeenCalled()

      await validate(60)
      expect(db.browserSession.updateMany).toHaveBeenCalledExactlyOnceWith({
        // Never a session revoked meanwhile, or one another request just noted.
        where: {
          id: 'browser-1',
          userId: 'owner',
          revokedAt: null,
          lastSeenAt: { lt: secondsAgo(60) },
        },
        data: { lastSeenAt: now },
      })
      await validate(3600)
      expect(db.browserSession.updateMany).toHaveBeenCalledTimes(2)
    }
  )

  it('answers the session even when another request noted its activity first', async () => {
    db.browserSession.updateMany.mockResolvedValue({ count: 0 })
    const found = session(120)
    expect(await validateBrowserSession('owner', 'browser-1', 2, found)).toBe(
      found
    )
  })
})
