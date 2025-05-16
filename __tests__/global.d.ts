import '@types/jest'

// Extend Jest global namespace
declare global {
  namespace jest {
    // Mock for TypeScript
    interface Mock<T = any, Y extends any[] = any[]> {
      mockResolvedValue: (value: T) => jest.Mock<T, Y>
      mockRejectedValue: (reason: any) => jest.Mock<T, Y>
    }
  }
}

export {}
