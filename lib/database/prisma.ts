import { PrismaClient } from '@prisma/client'

import { configureAuditWriter } from '../audit'
import { withPrismaAudit } from '../audit/prisma'
import { meticulousState } from '../meticulous'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient()
  const extension =
    meticulousState.meticulousRecorder?.meticulousPrismaExtension
  // Apply first so bundled Prisma operations are captured and can be replayed.
  const recorded = extension
    ? (client.$extends(extension) as unknown as PrismaClient)
    : client
  return withPrismaAudit(recorded)
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()
// Rebind after development hot reloads even when the connection pool is reused.
// AuditEvent is excluded from the model extension, so this cannot recurse.
configureAuditWriter(
  (data) => prisma.auditEvent.create({ data }),
  (data) => prisma.auditEvent.createMany({ data })
)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
