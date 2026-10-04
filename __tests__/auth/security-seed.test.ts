import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync('scripts/security/seed.cjs', 'utf8')

async function runSeed(databaseUrl: string) {
  const writes: string[] = []
  let finish!: () => void
  const completed = new Promise<void>((resolve) => (finish = resolve))
  const config = { value: { settings: { general: {} } } }
  const context = {
    URL,
    process: { env: { DATABASE_URL: databaseUrl }, exitCode: 0 },
    console: { log() {}, error() {} },
    require(id: string) {
      if (id === 'bcryptjs') return { hash: async () => 'fixture-hash' }
      if (id !== '@prisma/client') throw new Error(`Unexpected module ${id}`)
      return {
        PrismaClient: class {
          constructor() {
            writes.push('client created')
          }
          config = {
            findUnique: async () => config,
            update: async () => writes.push('config updated'),
          }
          user = {
            deleteMany: async () => writes.push('fixtures deleted'),
            upsert: async () => writes.push('fixture created'),
          }
          authRateLimit = {
            deleteMany: async () => writes.push('limits cleared'),
          }
          $disconnect() {
            finish()
          }
        },
      }
    },
  }
  try {
    runInNewContext(source, context)
  } catch (error) {
    return { writes, error: String(error), exitCode: context.process.exitCode }
  }
  await completed
  return { writes, error: null, exitCode: context.process.exitCode }
}

describe('disposable security seed boundary', () => {
  it.each([
    'postgresql://localhost/flare_auth_demo_backup',
    'postgresql://localhost/flare_auth_demo_production',
    'postgresql://localhost/flare_auth_demo/extra',
    'postgresql://localhost/flare_auth_demo?schema=backup',
    'postgresql://localhost/flare_auth_demo?schema=public&schema=public',
    'postgresql://localhost/flare_auth_demo?options=-csearch_path%3Dbackup',
    'postgresql://localhost/flare',
    'postgresql://production.example/flare_auth_demo',
    'https://localhost/flare_auth_demo',
  ])('rejects %s before creating a database client', async (url) => {
    const result = await runSeed(url)
    expect(result.error).toContain('named exactly flare_auth_demo')
    expect(result.writes).toEqual([])
  })

  it.each(['localhost', '127.0.0.1'])(
    'allows the exact disposable database on %s',
    async (hostname) => {
      const result = await runSeed(
        `postgresql://${hostname}:55432/flare_auth_demo`
      )
      expect(result.error).toBeNull()
      expect(result.exitCode).toBe(0)
      expect(result.writes).toEqual([
        'client created',
        'config updated',
        'fixtures deleted',
        'limits cleared',
        'fixture created',
        'fixture created',
      ])
    }
  )
})
