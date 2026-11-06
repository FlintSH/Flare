import { afterEach, expect, it, vi } from 'vitest'

import { recordAudit } from '@/lib/audit'

// This file's process never configures an audit writer.
const database = vi.hoisted(() => ({ loaded: vi.fn() }))
vi.mock('@/lib/database/prisma', () => {
  database.loaded()
  return { prisma: {} }
})

afterEach(() => vi.restoreAllMocks())

it('reports a missing audit writer without loading the database client', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(
    recordAudit({ action: 'file.delete', category: 'files' })
  ).resolves.toBeUndefined()
  expect(database.loaded).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledExactlyOnceWith(
    '[audit] Failed to persist an audit event (Error, unknown); check database availability and migrations'
  )
})
