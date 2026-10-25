import { hashSync } from 'bcryptjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type FileAccessInfo, checkFileAccess } from '@/lib/files/access'
import { FILE_PASSWORD_ATTEMPTS } from '@/lib/files/password-attempts'

const bcrypt = vi.hoisted(() => ({ compare: vi.fn() }))
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcryptjs')>()
  // bcryptjs is CommonJS; its functions may live only on the default export.
  const module = (actual as { default?: typeof actual }).default ?? actual
  bcrypt.compare.mockImplementation(module.compare)
  return {
    ...module,
    default: { ...module, compare: bcrypt.compare },
    compare: bcrypt.compare,
  }
})

const password = 'correct-horse-battery'
const passwordHash = hashSync(password, 4)
let sequence = 0

// Attempt state is process-wide, so every case uses its own file.
function protectedFile(hash = passwordHash): FileAccessInfo {
  return {
    id: `password-limit-${++sequence}`,
    visibility: 'PUBLIC',
    userId: 'owner',
    password: hash,
  }
}

const visitor = (requester: string | null = '203.0.113.7') => ({ requester })

afterEach(() => {
  vi.useRealTimers()
  bcrypt.compare.mockClear()
})

describe('file password attempt limits', () => {
  it('pauses one address after ten different wrong passwords, even for the right one', async () => {
    const file = protectedFile()
    for (
      let attempt = 1;
      attempt <= FILE_PASSWORD_ATTEMPTS.perRequester;
      attempt++
    )
      expect(
        await checkFileAccess(file, null, `wrong-${attempt}`, visitor())
      ).toMatchObject({
        allowed: false,
        reason: 'password_invalid',
        status: 401,
      })

    bcrypt.compare.mockClear()
    const paused = await checkFileAccess(file, null, password, visitor())
    expect(paused).toMatchObject({
      allowed: false,
      reason: 'password_rate_limited',
      status: 429,
    })
    expect(
      paused.allowed === false && paused.retryAfterSeconds
    ).toBeGreaterThan(14 * 60)
    // A paused check refuses before bcrypt, so it reveals nothing about guesses.
    expect(bcrypt.compare).not.toHaveBeenCalled()

    expect(
      await checkFileAccess(file, null, password, visitor('198.51.100.9'))
    ).toMatchObject({ allowed: true })
  })

  it('counts a repeated wrong password once', async () => {
    const file = protectedFile()
    for (let attempt = 0; attempt < 25; attempt++)
      expect(
        await checkFileAccess(file, null, 'same-typo', visitor())
      ).toMatchObject({ reason: 'password_invalid' })

    expect(
      await checkFileAccess(file, null, password, visitor())
    ).toMatchObject({ allowed: true })
  })

  it('counts only failures, and a correct password clears that address', async () => {
    const file = protectedFile()
    for (
      let attempt = 1;
      attempt < FILE_PASSWORD_ATTEMPTS.perRequester;
      attempt++
    )
      await checkFileAccess(file, null, `wrong-${attempt}`, visitor())
    expect(
      await checkFileAccess(file, null, password, visitor())
    ).toMatchObject({ allowed: true })
    for (
      let attempt = 1;
      attempt < FILE_PASSWORD_ATTEMPTS.perRequester;
      attempt++
    )
      expect(
        await checkFileAccess(file, null, `again-${attempt}`, visitor())
      ).toMatchObject({ reason: 'password_invalid' })
  })

  it('bounds guessing from rotating addresses with a per-file limit', async () => {
    const file = protectedFile()
    for (let attempt = 1; attempt <= FILE_PASSWORD_ATTEMPTS.perFile; attempt++)
      expect(
        await checkFileAccess(
          file,
          null,
          `rotating-${attempt}`,
          visitor(`192.0.2.${attempt}`)
        )
      ).toMatchObject({ reason: 'password_invalid' })

    expect(
      await checkFileAccess(file, null, password, visitor('198.51.100.200'))
    ).toMatchObject({ reason: 'password_rate_limited', status: 429 })
  })

  it('applies only the per-file limit when the client address is unknown', async () => {
    const file = protectedFile()
    for (let attempt = 1; attempt <= 20; attempt++)
      expect(
        await checkFileAccess(file, null, `unknown-${attempt}`, visitor(null))
      ).toMatchObject({ reason: 'password_invalid' })
    expect(
      await checkFileAccess(file, null, password, { requester: 'unknown' })
    ).toMatchObject({ allowed: true })
  })

  it('accepts passwords again after the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'))
    const file = protectedFile()
    for (
      let attempt = 1;
      attempt <= FILE_PASSWORD_ATTEMPTS.perRequester;
      attempt++
    )
      await checkFileAccess(file, null, `wrong-${attempt}`, visitor())
    expect(
      await checkFileAccess(file, null, password, visitor())
    ).toMatchObject({ status: 429 })

    vi.setSystemTime(
      new Date(
        Date.parse('2026-10-25T10:00:00Z') + FILE_PASSWORD_ATTEMPTS.windowMs
      )
    )
    expect(
      await checkFileAccess(file, null, password, visitor())
    ).toMatchObject({ allowed: true })
  })

  it('never limits the owner or a moderator', async () => {
    const file = protectedFile()
    for (let attempt = 1; attempt <= FILE_PASSWORD_ATTEMPTS.perFile; attempt++)
      await checkFileAccess(
        file,
        null,
        `flood-${attempt}`,
        visitor(`192.0.2.${attempt}`)
      )

    expect(
      await checkFileAccess(
        file,
        { user: { id: 'owner', permissions: ['files.read'] } },
        null,
        visitor()
      )
    ).toMatchObject({ allowed: true, isOwner: true })
    expect(
      await checkFileAccess(
        file,
        { user: { id: 'moderator', permissions: ['content.read'] } },
        null,
        visitor()
      )
    ).toMatchObject({ allowed: true, canModerate: true })
  })
})

describe('verified file password cache', () => {
  it('skips bcrypt for repeated requests with the correct password', async () => {
    const file = protectedFile()
    for (let request = 0; request < 5; request++)
      expect(
        await checkFileAccess(file, null, password, visitor())
      ).toMatchObject({ allowed: true })
    expect(bcrypt.compare).toHaveBeenCalledTimes(1)
  })

  it('stops matching when the file password changes', async () => {
    const file = protectedFile()
    expect(
      await checkFileAccess(file, null, password, visitor())
    ).toMatchObject({ allowed: true })

    const changed = { ...file, password: hashSync('a-new-password-2026', 4) }
    expect(
      await checkFileAccess(changed, null, password, visitor())
    ).toMatchObject({ reason: 'password_invalid' })
    expect(
      await checkFileAccess(changed, null, 'a-new-password-2026', visitor())
    ).toMatchObject({ allowed: true })
    expect(bcrypt.compare).toHaveBeenCalledTimes(3)
  })

  it('lets a viewer who already unlocked the file keep reading while it is paused', async () => {
    const file = protectedFile()
    expect(
      await checkFileAccess(file, null, password, visitor('198.51.100.30'))
    ).toMatchObject({ allowed: true })
    for (let attempt = 1; attempt <= FILE_PASSWORD_ATTEMPTS.perFile; attempt++)
      await checkFileAccess(
        file,
        null,
        `flood-${attempt}`,
        visitor(`192.0.2.${attempt}`)
      )

    expect(
      await checkFileAccess(file, null, password, visitor('198.51.100.30'))
    ).toMatchObject({ allowed: true })
  })

  it('does not let other addresses use a remembered unlock during a pause', async () => {
    const file = protectedFile()
    expect(
      await checkFileAccess(file, null, password, visitor('198.51.100.40'))
    ).toMatchObject({ allowed: true })
    for (let attempt = 1; attempt <= FILE_PASSWORD_ATTEMPTS.perFile; attempt++)
      await checkFileAccess(
        file,
        null,
        `flood-${attempt}`,
        visitor(`192.0.2.${attempt}`)
      )

    // Guessing the right password from a new address is still refused, so the
    // remembered unlock cannot answer guesses while checks are paused.
    expect(
      await checkFileAccess(file, null, password, visitor('192.0.2.250'))
    ).toMatchObject({ reason: 'password_rate_limited', status: 429 })
    expect(
      await checkFileAccess(file, null, password, visitor(null))
    ).toMatchObject({ reason: 'password_rate_limited', status: 429 })
  })
})
