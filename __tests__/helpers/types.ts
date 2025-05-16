import { NextResponse } from 'next/server'

import { PrismaClient } from '@prisma/client'

// Common type for API route handlers with mockImplementation
export type MockableFunction<T = any> = T & {
  mockImplementation: (
    implementation: (...args: any[]) => any
  ) => MockableFunction<T>
}

// Type for Prisma results
export type MockPrismaResult<T> = T & {
  [key: string]: any
}

// Turn any function into a mockable function
export function asMockFunction<T>(fn: T): MockableFunction<T> {
  return fn as MockableFunction<T>
}

// Cast any value to a Prisma result type
export function asPrismaResult<T>(value: T): any {
  return value
}

// Cast any object to a proper Request type
export type MockRequest = Request
export function asRequest(req: any): Request {
  return req as Request
}
