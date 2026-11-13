import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'

import { oncePerRequest, withRequestScope } from '@/lib/runtime/request-scope'

describe('values loaded once for a request', () => {
  it('loads a value once for every caller in the same request', async () => {
    const load = vi.fn(async () => ({ id: 'account' }))
    const seen = await withRequestScope(async () => {
      const first = oncePerRequest('account', load)
      // Later callers arrive after other work, as a route's own check does.
      await nextTurn()
      const second = oncePerRequest('account', load)
      expect(second).toBe(first)
      return [await first, await second, await oncePerRequest('account', load)]
    })
    expect(load).toHaveBeenCalledOnce()
    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).toBe(seen[0])
  })

  it('keeps values with different names apart', () => {
    const load = vi.fn((name: string) => ({ name }))
    withRequestScope(() => {
      const a = oncePerRequest('account:a', () => load('a'))
      const b = oncePerRequest('account:b', () => load('b'))
      expect(a).toEqual({ name: 'a' })
      expect(b).toEqual({ name: 'b' })
      expect(oncePerRequest('account:a', () => load('again'))).toBe(a)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('remembers a value that is undefined or null', () => {
    const load = vi.fn((): null | undefined => undefined)
    const missing = vi.fn(() => null)
    withRequestScope(() => {
      expect(oncePerRequest('nothing', load)).toBeUndefined()
      expect(oncePerRequest('nothing', load)).toBeUndefined()
      expect(oncePerRequest('missing', missing)).toBeNull()
      expect(oncePerRequest('missing', missing)).toBeNull()
    })
    expect(load).toHaveBeenCalledOnce()
    expect(missing).toHaveBeenCalledOnce()
  })

  it('shares nothing between requests, even while they overlap', async () => {
    let loads = 0
    const load = vi.fn(async () => ({ load: ++loads }))
    let releaseFirst!: () => void
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = withRequestScope(async () => {
      const before = await oncePerRequest('account', load)
      await firstMayFinish
      // The other request loaded its own value meanwhile.
      expect(await oncePerRequest('account', load)).toBe(before)
      return before
    })
    const second = await withRequestScope(async () => {
      const value = await oncePerRequest('account', load)
      expect(await oncePerRequest('account', load)).toBe(value)
      return value
    })
    releaseFirst()
    expect(await first).toEqual({ load: 1 })
    expect(second).toEqual({ load: 2 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('starts a request inside another one with nothing loaded', () => {
    const load = vi.fn(() => ({}))
    withRequestScope(() => {
      const outer = oncePerRequest('account', load)
      withRequestScope(() => {
        expect(oncePerRequest('account', load)).not.toBe(outer)
      })
      expect(oncePerRequest('account', load)).toBe(outer)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads every time outside a request', async () => {
    const load = vi.fn(async () => ({}))
    const first = await oncePerRequest('account', load)
    const second = await oncePerRequest('account', load)
    expect(load).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(first)
    // A request that ended left nothing behind either.
    await withRequestScope(() => oncePerRequest('account', load))
    await oncePerRequest('account', load)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('shares a load that fails with every caller in its request, and tries again in the next', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValue('loaded')
    await withRequestScope(async () => {
      const first = oncePerRequest('account', load)
      const second = oncePerRequest('account', load)
      expect(second).toBe(first)
      await expect(first).rejects.toThrow('Database unavailable')
      await expect(oncePerRequest('account', load)).rejects.toThrow(
        'Database unavailable'
      )
    })
    expect(load).toHaveBeenCalledOnce()
    expect(await withRequestScope(() => oncePerRequest('account', load))).toBe(
      'loaded'
    )
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('answers what the request’s work returns or throws', async () => {
    expect(withRequestScope(() => 'now')).toBe('now')
    await expect(withRequestScope(async () => 'later')).resolves.toBe('later')
    expect(() =>
      withRequestScope(() => {
        throw new Error('Refused')
      })
    ).toThrow('Refused')
    await expect(
      withRequestScope(async () => {
        throw new Error('Failed')
      })
    ).rejects.toThrow('Failed')
  })

  it('shares a request with every copy of the module in the process', async () => {
    const load = vi.fn(() => ({}))
    // Route bundles can each load their own copy.
    vi.resetModules()
    const copy = await import('@/lib/runtime/request-scope')
    expect(copy.oncePerRequest).not.toBe(oncePerRequest)
    withRequestScope(() => {
      expect(copy.oncePerRequest('account', load)).toBe(
        oncePerRequest('account', load)
      )
    })
    expect(load).toHaveBeenCalledOnce()
  })
})
