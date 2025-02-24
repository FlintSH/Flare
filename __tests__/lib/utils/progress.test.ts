import {
  clearProgress,
  getProgress,
  updateProgress,
} from '@/lib/utils/progress'

describe('Progress Utilities', () => {
  const userId = 'test-user-id'

  beforeEach(() => {
    // Clear any existing progress before each test
    clearProgress(userId)
  })

  describe('updateProgress', () => {
    it('should update progress for a user', () => {
      updateProgress(userId, 50)
      expect(getProgress(userId)).toBe(50)
    })

    it('should overwrite existing progress', () => {
      updateProgress(userId, 25)
      updateProgress(userId, 75)
      expect(getProgress(userId)).toBe(75)
    })

    it('should handle 0 progress', () => {
      updateProgress(userId, 0)
      expect(getProgress(userId)).toBe(0)
    })

    it('should handle 100 progress', () => {
      updateProgress(userId, 100)
      expect(getProgress(userId)).toBe(100)
    })
  })

  describe('clearProgress', () => {
    it('should clear progress for a user', () => {
      updateProgress(userId, 50)
      clearProgress(userId)
      expect(getProgress(userId)).toBe(0)
    })

    it('should handle clearing non-existent progress', () => {
      clearProgress('non-existent-user')
      expect(getProgress('non-existent-user')).toBe(0)
    })
  })

  describe('getProgress', () => {
    it('should return 0 for non-existent user', () => {
      expect(getProgress('non-existent-user')).toBe(0)
    })

    it('should return correct progress for existing user', () => {
      updateProgress(userId, 75)
      expect(getProgress(userId)).toBe(75)
    })
  })

  describe('multiple users', () => {
    it('should handle progress for multiple users independently', () => {
      const user1 = 'user-1'
      const user2 = 'user-2'

      updateProgress(user1, 25)
      updateProgress(user2, 75)

      expect(getProgress(user1)).toBe(25)
      expect(getProgress(user2)).toBe(75)

      clearProgress(user1)
      expect(getProgress(user1)).toBe(0)
      expect(getProgress(user2)).toBe(75)
    })
  })
})
