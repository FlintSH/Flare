import { describe, expect, it } from 'vitest'

describe('test harness', () => {
  it('runs and resolves @/* path aliases', async () => {
    const mod = await import('@/lib/security/file-validation')
    expect(typeof mod.validateFileType).toBe('function')
  })
})
