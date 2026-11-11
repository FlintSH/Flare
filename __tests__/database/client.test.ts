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
})
afterEach(() => vi.unstubAllEnvs())

describe('the database client', () => {
  it('applies the audit extension', async () => {
    const { prisma } = await import('@/lib/database/prisma')
    expect(prisma).toEqual({ layers: ['base', 'audit'] })
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
