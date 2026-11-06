import { compare, getRounds } from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'

const mocks = vi.hoisted(() => ({
  lockEmailAddress: vi.fn(),
  sendAccountToken: vi.fn(),
  invalidateEmailTokens: vi.fn(),
  ensureBuiltInRoles: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    user: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    authChallenge: { deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/database/locks', () => ({
  lockEmailAddress: mocks.lockEmailAddress,
}))
vi.mock('@/lib/email/account', () => ({
  sendAccountToken: mocks.sendAccountToken,
}))
vi.mock('@/lib/email/tokens', () => ({
  invalidateEmailTokens: mocks.invalidateEmailTokens,
}))
vi.mock('@/lib/permissions/server', () => ({
  ensureBuiltInRoles: mocks.ensureBuiltInRoles,
}))

const { createAccount, verifiesNewAccounts } =
  await import('@/lib/users/create-account')
const { changeCredentials, hashAccountPassword } =
  await import('@/lib/users/credentials')

const tx = mocks.tx as never
const account = { email: 'new@example.test', name: 'N', password: 'hash' }

function emailConfig(changes: Partial<EmailConfig> = {}): EmailConfig {
  return {
    ...structuredClone(DEFAULT_EMAIL_CONFIG),
    enabled: true,
    ...changes,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.tx.user.count.mockResolvedValue(3)
  mocks.tx.user.findFirst.mockResolvedValue(null)
  mocks.tx.user.findMany.mockResolvedValue([])
  mocks.tx.user.findUnique.mockResolvedValue(null)
  mocks.tx.user.create.mockImplementation(async ({ data }) => ({
    id: 'created',
    ...data,
  }))
  mocks.ensureBuiltInRoles.mockResolvedValue({
    administrator: { id: 'administrator' },
  })
})

describe('createAccount', () => {
  it('claims a mailbox in any letter case, with LIKE characters kept literal', async () => {
    const created = await createAccount(
      tx,
      { ...account, email: 'a_b%c@example.test' },
      { enabled: true }
    )
    expect(created).not.toBeNull()
    expect(mocks.lockEmailAddress).toHaveBeenCalledWith(
      tx,
      'a_b%c@example.test'
    )
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'a\\_b\\%c@example.test', mode: 'insensitive' },
      },
      select: { id: true },
    })
  })

  it('claims an exact address while email is disabled', async () => {
    mocks.tx.user.findFirst.mockResolvedValue({ id: 'holder' })
    expect(await createAccount(tx, account)).toBeNull()
    expect(mocks.lockEmailAddress).toHaveBeenCalledWith(tx, account.email)
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: { email: account.email },
      select: { id: true },
    })
    expect(mocks.tx.user.create).not.toHaveBeenCalled()
  })

  it('returns null without creating anything when the mailbox is taken', async () => {
    mocks.tx.user.findFirst.mockResolvedValue({ id: 'holder' })
    expect(
      await createAccount(tx, account, { verifyWith: emailConfig() })
    ).toBeNull()
    expect(mocks.tx.user.create).not.toHaveBeenCalled()
    expect(mocks.sendAccountToken).not.toHaveBeenCalled()
  })

  it('makes the first account an administrator and mints its upload token', async () => {
    mocks.tx.user.count.mockResolvedValue(0)
    await createAccount(tx, { ...account, roleIds: ['moderator'] })
    const { data } = mocks.tx.user.create.mock.calls[0][0]
    expect(data.roles).toEqual({
      connect: [{ id: 'moderator' }, { id: 'administrator' }],
    })
    expect(data.uploadToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('sends a verification link to a typed address when the settings ask for one', async () => {
    const config = emailConfig({
      recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
    })
    const created = await createAccount(tx, account, { verifyWith: config })
    expect(mocks.tx.user.create.mock.calls[0][0].data).toMatchObject({
      emailVerificationSource: 'pending_local',
    })
    expect(mocks.sendAccountToken).toHaveBeenCalledWith(
      tx,
      created,
      'verify',
      config
    )
  })

  it('sends nothing when verification and recovery are off, or for an identity provider address', async () => {
    await createAccount(tx, account, { verifyWith: emailConfig() })
    await createAccount(
      tx,
      { ...account, emailVerificationSource: 'oidc' },
      { enabled: true }
    )
    expect(mocks.sendAccountToken).not.toHaveBeenCalled()
    expect(
      mocks.tx.user.create.mock.calls.map(
        ([{ data }]) => data.emailVerificationSource
      )
    ).toEqual([undefined, 'oidc'])
  })

  it('verifies new accounts only when email is on and verification or recovery needs the address', () => {
    const on = {
      ...DEFAULT_EMAIL_CONFIG.verification,
      mode: 'optional' as const,
    }
    const recovery = { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true }
    expect(verifiesNewAccounts(emailConfig())).toBe(false)
    expect(verifiesNewAccounts(emailConfig({ verification: on }))).toBe(true)
    expect(verifiesNewAccounts(emailConfig({ recovery }))).toBe(true)
    expect(
      verifiesNewAccounts(emailConfig({ enabled: false, verification: on }))
    ).toBe(false)
  })
})

describe('changeCredentials', () => {
  it('signs out everywhere and cancels pending email work for a new password', async () => {
    const change = await changeCredentials(tx, 'account', {
      password: 'new-hash',
      rotateUploadToken: true,
    })
    expect(change).toEqual({
      password: 'new-hash',
      pendingEmail: null,
      pendingEmailOldConfirmed: false,
      uploadToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sessionVersion: { increment: 1 },
    })
    // The caller saves the change in its one update of the row.
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    expect(mocks.invalidateEmailTokens).toHaveBeenCalledWith(tx, 'account')
    expect(mocks.tx.authChallenge.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'account' },
    })
  })

  it('records whether a link proved a new address', async () => {
    const proven = await changeCredentials(tx, 'account', {
      email: { address: 'proven@example.test', verified: true },
    })
    const typed = await changeCredentials(tx, 'account', {
      email: { address: 'typed@example.test', verified: false },
    })
    expect(proven).toMatchObject({
      email: 'proven@example.test',
      emailVerified: expect.any(Date),
      emailVerifiedFor: 'proven@example.test',
      emailVerificationSource: 'email',
    })
    expect(proven).not.toHaveProperty('password')
    expect(proven).not.toHaveProperty('uploadToken')
    expect(typed).toMatchObject({
      email: 'typed@example.test',
      emailVerified: null,
      emailVerifiedFor: null,
      emailVerificationSource: null,
    })
  })
})

describe('hashAccountPassword', () => {
  it('stores an account password as a cost-10 bcrypt hash', async () => {
    const stored = await hashAccountPassword('correct horse battery')
    expect(getRounds(stored)).toBe(10)
    expect(await compare('correct horse battery', stored)).toBe(true)
    expect(await compare('wrong horse battery', stored)).toBe(false)
  })
})
