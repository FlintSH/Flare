import { PrismaClient } from '@prisma/client'

import { meticulousState } from '../meticulous'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient()
  const extension =
    meticulousState.meticulousRecorder?.meticulousPrismaExtension
  // Apply first so bundled Prisma operations are captured and can be replayed.
  return extension
    ? (client.$extends(extension) as unknown as PrismaClient)
    : client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
