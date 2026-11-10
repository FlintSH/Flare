import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { hashApiToken } from '@/lib/integrations/tokens'

/**
 * The migration that replaces each stored upload token with its hash
 * (docs/e2ee-spec.md, section 14.4). An old configuration continues to
 * authenticate only if PostgreSQL calculates the hash that the application
 * looks up, so this runs the expression of the migration in PostgreSQL.
 */
const databaseUrl = process.env.FLARE_E2EE_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

vi.setConfig({ testTimeout: 30_000 })

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261113000000_e2ee_upload_tokens/migration.sql'
  ),
  'utf8'
)
const HASH = `encode(sha256(convert_to("uploadToken", 'UTF8')), 'hex')`

suite('the upload token migration against PostgreSQL', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  afterAll(() => prisma.$disconnect())

  it('hashes each stored token as the application hashes a presented token', async () => {
    expect(migration).toContain(`SET "uploadTokenHash" = ${HASH};`)
    const tokens = [
      randomUUID(),
      'legacy-MixedCaseToken',
      'token with spaces and ünïcödé ✓',
      '',
    ]
    for (const token of tokens) {
      const [row] = await prisma.$queryRawUnsafe<{ hash: string }[]>(
        `SELECT ${HASH} AS hash FROM (VALUES ($1::text)) AS stored("uploadToken")`,
        token
      )
      expect(row.hash).toBe(hashApiToken(token))
    }
  })

  it('leaves no column that holds a token, and marks the tokens of before', async () => {
    const columns = await prisma.$queryRaw<
      {
        table_name: string
        column_name: string
        column_default: string | null
      }[]
    >`SELECT table_name, column_name, column_default
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name IN ('User', 'ApiToken')`
    const names = (table: string) =>
      columns
        .filter((column) => column.table_name === table)
        .map((column) => column.column_name)
    expect(names('User')).toContain('uploadTokenHash')
    expect(names('User')).toContain('uploadTokenUsedAt')
    expect(names('User')).not.toContain('uploadToken')
    // A token made after the migration is not one "from before encryption".
    expect(
      columns.find((column) => column.column_name === 'predatesEncryption')
        ?.column_default
    ).toBe('false')
    // The statement of the migration that marks each existing named token.
    expect(migration).toContain(
      'UPDATE "ApiToken" SET "predatesEncryption" = true;'
    )
    // The plain column is dropped only after the hash is written.
    expect(migration.indexOf('SET "uploadTokenHash"')).toBeLessThan(
      migration.indexOf('DROP COLUMN "uploadToken"')
    )
  })

  it('finds an account by the hash, and a second account cannot hold the same token', async () => {
    const token = randomUUID()
    const ids = [randomUUID(), randomUUID()]
    try {
      await prisma.user.create({
        data: {
          id: ids[0],
          urlId: ids[0],
          uploadTokenHash: hashApiToken(token),
        },
      })
      expect(
        (
          await prisma.user.findUnique({
            where: { uploadTokenHash: hashApiToken(token) },
          })
        )?.id
      ).toBe(ids[0])
      await expect(
        prisma.user.create({
          data: {
            id: ids[1],
            urlId: ids[1],
            uploadTokenHash: hashApiToken(token),
          },
        })
      ).rejects.toMatchObject({ code: 'P2002' })
      // Accounts without an old token do not collide with each other.
      await prisma.user.create({ data: { id: ids[1], urlId: ids[1] } })
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
  })
})
