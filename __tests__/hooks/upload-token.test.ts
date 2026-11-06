import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUploadToken } from '@/hooks/use-upload-token'

// Keeps hook state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  toast: vi.fn(),
}))

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (next: unknown) => {
        harness.slots[index] =
          typeof next === 'function' ? next(harness.slots[index]) : next
      },
    ]
  },
  useCallback: (callback: unknown) => callback,
  // The test loads the token itself.
  useEffect: () => {},
}))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: harness.toast }),
}))

const fetchMock = vi.fn<typeof fetch>()

function render() {
  harness.cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useUploadToken()
}

beforeEach(() => {
  harness.slots = []
  harness.toast.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('account upload token', () => {
  it('loads and replaces the token', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ uploadToken: 'first' }))
      .mockResolvedValueOnce(Response.json({ uploadToken: 'second' }))
    await render().handleLoadToken()
    expect(render().uploadToken).toBe('first')
    await render().handleRefreshToken()
    expect(render().uploadToken).toBe('second')
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/profile/upload-token',
      expect.objectContaining({ method: 'POST' })
    )
    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Success',
      description:
        'Upload token replaced. Download fresh configurations to reconnect your tools.',
    })
  })

  it('shows the server’s reason when it refuses', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Too many requests' }, { status: 429 })
    )
    await render().handleRefreshToken()
    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Too many requests',
      variant: 'destructive',
    })
  })

  it('keeps its own message when the server gives no reason or cannot be reached', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await render().handleLoadToken()
    await render().handleRefreshToken()
    expect(harness.toast.mock.calls.map(([notice]) => notice)).toEqual([
      {
        title: 'Error',
        description: 'Failed to fetch upload token',
        variant: 'destructive',
      },
      {
        title: 'Error',
        description: 'Failed to refresh upload token',
        variant: 'destructive',
      },
    ])
    expect(render().isLoadingToken).toBe(false)
  })
})
