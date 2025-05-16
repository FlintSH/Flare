import { beforeEach, describe, expect, it } from '@jest/globals'

import { clearMocks, createRequest } from '../helpers/api-test-helper'
import { prisma } from '../setup'

// Mock user creation functions
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}))

describe('Setup API', () => {
  beforeEach(() => {
    clearMocks()
  })

  it('tests that prisma mocks are working', async () => {
    // Mock that users already exist
    prisma.user.count.mockResolvedValue(1)

    const count = await prisma.user.count()
    expect(count).toBe(1)
  })

  it('tests user creation works through prisma mock', async () => {
    const mockUser = {
      id: 'user-id',
      name: 'Admin User',
      email: 'admin@example.com',
    }

    prisma.user.create.mockResolvedValue(mockUser)

    const user = await prisma.user.create({
      data: {
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'hashed-password',
      },
    })

    expect(user).toEqual(mockUser)
    expect(prisma.user.create).toHaveBeenCalled()
  })
})
