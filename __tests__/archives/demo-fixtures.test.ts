import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('archive demo fixture isolation', () => {
  it.each([
    'postgresql://fixture:fixture@database.example/archive_demo',
    'postgresql://fixture:fixture@localhost/production',
    'postgresql://fixture:fixture@127.0.0.1/archive_demo?schema=production',
    'postgresql://fixture:fixture@localhost/archive_demo?schema=public&schema=public',
    'postgresql://fixture:fixture@localhost/archive_demo?host=database.example',
  ])('refuses %s before database mutation', (database) => {
    const result = spawnSync(process.execPath, ['scripts/archives/seed.cjs'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: database },
      encoding: 'utf8',
      timeout: 5000,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Archive demos require the public schema of a local PostgreSQL database named archive_demo.'
    )
  })
})
