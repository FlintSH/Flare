import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { removeAvatar, removeOwnAvatar } from '@/lib/users/avatar'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  lock: vi.fn(),
  queue: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/permissions/account-mutations', () => ({
  mutateAccount: mocks.mutate,
}))
vi.mock('@/lib/database/locks', () => ({
  lockUserRow: mocks.lock,
  lockRoleChanges: vi.fn(),
}))
vi.mock('@/lib/storage/deletion', () => ({ queueStorageDeletion: mocks.queue }))

const tx = { user: { findUnique: mocks.findUser, update: mocks.updateUser } }
const target = { provider: 'local' }
const account = {
  id: 'owner',
  image: '/api/avatars/owner-1.jpg',
  avatarStoragePath: 'uploads/avatars/owner-1.jpg',
  avatarStorageTarget: target,
}

beforeEach(() => {
  vi.resetAllMocks()
  // Like the real one once it has checked who asks: it runs the change.
  mocks.mutate.mockImplementation(
    async (_actor, _target, _permission, change) => change(tx)
  )
  mocks.findUser.mockResolvedValue(account)
})

function expectAvatarCleared(userId: string) {
  expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(tx, userId)
  expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
    tx,
    userId,
    'uploads/avatars/owner-1.jpg',
    target
  )
  expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
    where: { id: userId },
    data: {
      image: null,
      avatarStoragePath: null,
      avatarStorageTarget: Prisma.DbNull,
    },
  })
  // The bytes are queued in the transaction that drops the avatar.
  expect(mocks.queue.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.updateUser.mock.invocationCallOrder[0]
  )
}

describe('removing an avatar', () => {
  it('lets an account clear its own with the permission that uploads one', async () => {
    await removeOwnAvatar('owner')
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'owner',
      'profile.update',
      expect.any(Function),
      // Its own account: no check that it may manage the target.
      true
    )
    expectAvatarCleared('owner')
  })

  it("lets an administrator clear another account's, as before", async () => {
    mocks.findUser.mockResolvedValue({ ...account, id: 'member' })
    await removeAvatar('admin', 'member')
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(
      'admin',
      'member',
      'users.update',
      expect.any(Function)
    )
    expectAvatarCleared('member')
  })

  it('changes nothing when the permission check refuses', async () => {
    mocks.mutate.mockRejectedValue(new Error('refused'))
    await expect(removeOwnAvatar('owner')).rejects.toThrow('refused')
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('queues nothing for an account without a stored avatar, and still clears the image', async () => {
    mocks.findUser.mockResolvedValue({
      id: 'owner',
      image: 'https://provider.example/alex.png',
      avatarStoragePath: null,
      avatarStorageTarget: null,
    })
    await removeOwnAvatar('owner')
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.updateUser).toHaveBeenCalledOnce()
  })

  it('answers 404 for an account that is gone', async () => {
    mocks.findUser.mockResolvedValue(null)
    await expect(removeOwnAvatar('owner')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    })
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
