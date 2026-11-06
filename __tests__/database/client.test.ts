import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-in clients list the extensions applied to them, first applied first.
const clients = vi.hoisted(() => ({ built: 0 }))
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    layers = ['base']
    constructor() {
      clients.built++
    }
    $extends(extension: { name: string }) {
      return { layers: [...this.layers, extension.name] }
    }
  },
}))
vi.mock('@/lib/audit/prisma', () => ({
  withPrismaAudit: (client: { layers: string[] }) => ({
    layers: [...client.layers, 'audit'],
  }),
}))

const processState = globalThis as typeof globalThis & Record<symbol, unknown>

beforeEach(() => {
  vi.resetModules()
  clients.built = 0
  delete processState[Symbol.for('flare.database.client')]
  delete processState[Symbol.for('flare.database.query-recorder')]
})
afterEach(() => vi.unstubAllEnvs())

describe('the database client', () => {
  it('applies a registered query recorder before the audit extension', async () => {
    const { recordDatabaseQueries } =
      await import('@/lib/database/query-recorder')
    recordDatabaseQueries({ name: 'recorder' })
    const { prisma } = await import('@/lib/database/prisma')
    expect(prisma).toEqual({ layers: ['base', 'recorder', 'audit'] })
  })

  it('applies only the audit extension when no recorder is registered', async () => {
    const { prisma } = await import('@/lib/database/prisma')
    expect(prisma).toEqual({ layers: ['base', 'audit'] })
  })

  it('refuses a recorder registered after the client was built', async () => {
    await import('@/lib/database/prisma')
    const { recordDatabaseQueries } =
      await import('@/lib/database/query-recorder')
    expect(() => recordDatabaseQueries({ name: 'recorder' })).toThrow(
      'The database client was built before its query recorder was registered.'
    )
  })

  it('keeps one client per process in production too', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { prisma } = await import('@/lib/database/prisma')
    // Instrumentation, route handlers and pages each load their own copy.
    vi.resetModules()
    const copy = await import('@/lib/database/prisma')
    expect(copy.prisma).toBe(prisma)
    expect(clients.built).toBe(1)
  })
})
