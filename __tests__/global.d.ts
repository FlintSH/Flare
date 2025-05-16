import '@types/jest'

// Extend Jest global namespace
declare global {
  namespace jest {
    // Mock for TypeScript
    interface Mock<T = any, Y extends any[] = any[]> extends Function {
      (...args: Y): T
      mockImplementation(fn: (...args: Y) => T): this
      mockResolvedValue(val: T): this
      mockRejectedValue(val: any): this
      mockReturnValue(val: T): this
      mockReturnThis(): this
      mockClear(): this
      mockReset(): this
      mockRestore(): this
    }
  }
}

// Make TypeScript happy with our mock API methods
declare module '@/app/api/auth/[...nextauth]/route' {
  export const GET: any
  export const POST: any
}

// Add for all other routes we mock in tests
declare module '@/app/api/health/route' {
  export const GET: any
}

declare module '@/app/api/auth/register/route' {
  export const POST: any
}

declare module '@/app/api/auth/registration-status/route' {
  export const GET: any
}

declare module '@/app/api/setup/route' {
  export const POST: any
}

declare module '@/app/api/setup/check/route' {
  export const GET: any
}

declare module '@/app/api/users/route' {
  export const GET: any
  export const POST: any
  export const PUT: any
}

declare module '@/app/api/users/[id]/route' {
  export const GET: any
  export const DELETE: any
}

declare module '@/app/api/files/route' {
  export const GET: any
  export const POST: any
}

declare module '@/app/api/files/[id]/route' {
  export const GET: any
  export const PUT: any
  export const DELETE: any
}

// Add Jest typings for our tests
declare namespace jest {
  // This avoids conflicts with actual function definitions
  interface MockInterface<T = any, Y extends any[] = any[]> {
    mockImplementation(fn: (...args: Y) => T): this
    mockResolvedValue(val: T): this
    mockRejectedValue(val: any): this
    mockReturnValue(val: T): this
    mockReturnThis(): this
    mockClear(): this
    mockReset(): this
    mockRestore(): this
  }
}

// Tell TypeScript to ignore the mock declarations
declare module '*.ts' {
  const content: any
  export default content
}

// Tell TypeScript to treat test helpers as non-type modules
declare module '__tests__/helpers/*' {
  const content: any
  export default content
  export * from 'index'
}

export {}
