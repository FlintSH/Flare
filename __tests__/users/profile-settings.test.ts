import { PUT } from '@/app/api/profile/route'
import type { User } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  accountToEdit,
  profileSettingsSchema,
  saveProfile,
  updateProfileSettings,
} from '@/lib/users/profile'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findUser: vi.fn(),
  updateAccount: vi.fn(),
  emailConfig: vi.fn(),
  emailConfigForUpdate: vi.fn(),
  securitySession: vi.fn(),
  fresh: vi.fn(),
  hash: vi.fn(),
  compare: vi.fn(),
  tx: { marker: 'the transaction' },
}))
vi.mock('@/lib/auth/api-auth', () => ({ getAuthenticatedUser: mocks.user }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    $transaction: (run: (tx: unknown) => unknown) => run(mocks.tx),
  },
}))
vi.mock('@/lib/users/update-account', () => ({
  updateAccount: mocks.updateAccount,
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: mocks.emailConfig,
  getEmailConfigForUpdate: mocks.emailConfigForUpdate,
}))
vi.mock('@/lib/auth/security/http', () => ({
  securitySession: mocks.securitySession,
}))
vi.mock('@/lib/auth/security/service', () => ({
  assertFreshIdentity: mocks.fresh,
}))
vi.mock('@/lib/users/credentials', () => ({ hashAccountPassword: mocks.hash }))
vi.mock('@/lib/users/delete-account', () => ({ deleteAccount: vi.fn() }))
vi.mock('bcryptjs', () => ({ compare: mocks.compare }))

const account = {
  id: 'owner',
  name: 'Alex',
  email: 'alex@example.com',
  password: 'stored-hash',
  sessionVersion: 3,
} as User

/** The fields the profile route has always asked the save to answer. */
const select = {
  id: true,
  name: true,
  email: true,
  image: true,
  randomizeFileUrls: true,
  vanityId: true,
}
const answered = {
  id: 'owner',
  name: 'Mira',
  email: 'alex@example.com',
  image: null,
  randomizeFileUrls: true,
  vanityId: 'mira',
}

const put = (body: unknown) =>
  PUT(
    new Request('https://flare.example/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flare.example',
      },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
  mocks.user.mockResolvedValue({
    id: 'owner',
    permissions: ['profile.update'],
    credential: 'session',
  })
  mocks.findUser.mockResolvedValue(account)
  mocks.emailConfig.mockResolvedValue({ enabled: false })
  mocks.emailConfigForUpdate.mockResolvedValue({ enabled: false })
  mocks.updateAccount.mockResolvedValue(answered)
})

describe('PUT /api/profile', () => {
  it('saves the settings a body names exactly as before, with nothing to prove', async () => {
    const response = await put({
      name: 'Mira',
      vanityId: 'mira',
      randomizeFileUrls: true,
      defaultFileExpiration: 'WEEK',
      defaultFileExpirationAction: 'SET_PRIVATE',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: answered })
    expect(mocks.updateAccount).toHaveBeenCalledExactlyOnceWith(
      mocks.tx,
      account,
      {
        name: 'Mira',
        email: undefined,
        password: undefined,
        vanityId: 'mira',
        settings: {
          randomizeFileUrls: true,
          defaultFileExpiration: 'WEEK',
          defaultFileExpirationAction: 'SET_PRIVATE',
        },
      },
      { kind: 'self', emailEnabled: false, prove: undefined },
      select
    )
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: 'owner' } })
    expect(mocks.securitySession).not.toHaveBeenCalled()
    expect(mocks.emailConfigForUpdate).not.toHaveBeenCalled()
  })

  it('leaves out every setting the body leaves out, and clears a vanity ID with null', async () => {
    await put({ vanityId: null })
    expect(mocks.updateAccount.mock.calls[0][2]).toEqual({
      name: undefined,
      email: undefined,
      password: undefined,
      vanityId: null,
      settings: {},
    })
    await put({ randomizeFileUrls: false })
    expect(mocks.updateAccount.mock.calls[1][2].settings).toEqual({
      randomizeFileUrls: false,
    })
    expect(mocks.updateAccount.mock.calls[1][2]).not.toHaveProperty(
      'vanityId',
      null
    )
  })

  it('still changes the password itself, with the proof and the email policy it reads under the lock', async () => {
    mocks.securitySession.mockResolvedValue({ session: { id: 'browser' } })
    mocks.compare.mockResolvedValue(true)
    mocks.hash.mockResolvedValue('new-hash')
    mocks.findUser
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ password: 'stored-hash' })
    mocks.emailConfigForUpdate.mockResolvedValue({ enabled: true })
    const response = await put({
      name: 'Mira',
      currentPassword: 'the-old-password',
      securityCode: '123456',
      newPassword: 'a-new-password',
    })
    expect(response.status).toBe(200)
    const [tx, seen, edit, editor, fields] = mocks.updateAccount.mock.calls[0]
    expect(tx).toBe(mocks.tx)
    expect(seen).toBe(account)
    expect(edit).toEqual({
      name: 'Mira',
      email: undefined,
      password: 'new-hash',
      vanityId: undefined,
      settings: {},
    })
    expect(editor).toMatchObject({ kind: 'self', emailEnabled: true })
    expect(fields).toEqual(select)
    // The proof is checked against the browser session, once the row is locked.
    await editor.prove({ id: 'owner' })
    expect(mocks.fresh).toHaveBeenCalledExactlyOnceWith(
      { id: 'owner' },
      { password: 'the-old-password', code: '123456' },
      { id: 'browser' },
      { secondFactor: true, tx: mocks.tx }
    )
  })

  it('still sends a new address as a credential change', async () => {
    mocks.securitySession.mockResolvedValue({ session: { id: 'browser' } })
    await put({ email: 'mira@example.com', randomizeFileUrls: true })
    const [, , edit, editor] = mocks.updateAccount.mock.calls[0]
    expect(edit).toEqual({
      name: undefined,
      email: 'mira@example.com',
      password: undefined,
      vanityId: undefined,
      settings: { randomizeFileUrls: true },
    })
    expect(editor.prove).toEqual(expect.any(Function))
    // The address the account already has is no change.
    await put({ email: 'alex@example.com' })
    expect(mocks.updateAccount.mock.calls[1][2].email).toBeUndefined()
    expect(mocks.updateAccount.mock.calls[1][3].prove).toBeUndefined()
  })

  it('answers 404 for an account that is gone, before anything else', async () => {
    mocks.findUser.mockResolvedValue(null)
    const response = await put({ name: 'Mira' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'User not found' })
    expect(mocks.emailConfig).not.toHaveBeenCalled()
    expect(mocks.updateAccount).not.toHaveBeenCalled()
  })
})

describe('saving profile settings without the route', () => {
  it('sends the same edit the route sends for the same settings', async () => {
    const settings = {
      name: 'Mira',
      vanityId: 'mira',
      randomizeFileUrls: true,
      defaultFileExpiration: 'WEEK',
      defaultFileExpirationAction: 'SET_PRIVATE',
    } as const
    await put(settings)
    expect(await updateProfileSettings(account, settings)).toBe(answered)
    const [route, direct] = mocks.updateAccount.mock.calls
    expect(direct).toEqual(route)
    expect(direct[0]).toBe(mocks.tx)
  })

  it('never carries an address, a password or a proof', async () => {
    // Fields the settings do not have are not read, whatever is handed in.
    await updateProfileSettings(account, {
      name: 'Mira',
      email: 'mira@example.com',
      newPassword: 'a-new-password',
      currentPassword: 'the-old-password',
    } as never)
    const [, , edit, editor] = mocks.updateAccount.mock.calls[0]
    expect(edit).toEqual({
      name: 'Mira',
      email: undefined,
      password: undefined,
      vanityId: undefined,
      settings: {},
    })
    expect(editor).toEqual({
      kind: 'self',
      emailEnabled: false,
      prove: undefined,
    })
    expect(mocks.hash).not.toHaveBeenCalled()
    expect(mocks.securitySession).not.toHaveBeenCalled()
  })

  it('takes credentials only from the caller that proves them', async () => {
    const prove = vi.fn()
    await saveProfile(
      mocks.tx as never,
      account,
      { randomizeFileUrls: false },
      { email: 'mira@example.com', emailEnabled: true, prove }
    )
    expect(mocks.updateAccount).toHaveBeenCalledExactlyOnceWith(
      mocks.tx,
      account,
      {
        name: undefined,
        email: 'mira@example.com',
        password: undefined,
        vanityId: undefined,
        settings: { randomizeFileUrls: false },
      },
      { kind: 'self', emailEnabled: true, prove },
      select
    )
  })

  it('reads the account to edit, and refuses one that is gone', async () => {
    expect(await accountToEdit('owner')).toBe(account)
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: 'owner' } })
    mocks.findUser.mockResolvedValue(null)
    await expect(accountToEdit('owner')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    })
  })

  it('has a schema for the settings that holds the route rules and no credential', () => {
    expect(Object.keys(profileSettingsSchema.shape).sort()).toEqual([
      'defaultFileExpiration',
      'defaultFileExpirationAction',
      'name',
      'randomizeFileUrls',
      'vanityId',
    ])
    const issue = (value: object) =>
      profileSettingsSchema.safeParse(value).error?.issues[0]?.message
    expect(issue({ vanityId: 'admin' })).toBe(
      'This URL path is reserved and cannot be used'
    )
    expect(issue({ vanityId: 'ab' })).toBe(
      'Vanity URL must be at least 3 characters'
    )
    expect(issue({ name: '' })).toBe('Username is required')
    expect(issue({ defaultFileExpiration: 'YEAR' })).toEqual(expect.any(String))
    expect(issue({ vanityId: null, name: 'Mira' })).toBeUndefined()
    // A credential handed to it is dropped, not validated or passed on.
    expect(
      profileSettingsSchema.parse({ name: 'Mira', email: 'not an address' })
    ).toEqual({ name: 'Mira' })
  })
})
