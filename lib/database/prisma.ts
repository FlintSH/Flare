import { PrismaClient } from '@prisma/client'

import { withPrismaAudit } from '@/lib/audit/prisma'

import { withQueryRecorder } from './query-recorder'

// Instrumentation, route handlers and pages are bundled with separate copies
// of this module. Each process keeps one client and one connection pool.
const clientKey = Symbol.for('flare.database.client')
const processState = globalThis as typeof globalThis & {
  [clientKey]?: PrismaClient
}

export const prisma = (processState[clientKey] ??= withPrismaAudit(
  withQueryRecorder(new PrismaClient())
))
