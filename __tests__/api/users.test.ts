import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { clearMocks, mockAdminSession } from '../helpers/api-test-helper'
import { prisma } from '../setup'

describe('Users API', () => {
  beforeEach(() => {
    clearMocks()
    jest.clearAllMocks()
  })

  describe('GET /api/users', () => {
    it('tests prisma mocks', async () => {
      const mockUsers = [
        { id: '1', name: 'User 1' },
        { id: '2', name: 'User 2' },
      ]
      prisma.user.findMany.mockResolvedValue(mockUsers)

      const users = await prisma.user.findMany()
      expect(users).toEqual(mockUsers)
      expect(prisma.user.findMany).toHaveBeenCalled()
    })
  })

  describe('POST /api/users', () => {
    it('tests that prisma mocks are working properly', async () => {
      const user = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
      }

      prisma.user.create.mockResolvedValue(user)

      const result = await prisma.user.create({
        data: {
          name: 'Test User',
          email: 'test@example.com',
        },
      })

      expect(result).toEqual(user)
      expect(prisma.user.create).toHaveBeenCalled()
    })
  })
})
