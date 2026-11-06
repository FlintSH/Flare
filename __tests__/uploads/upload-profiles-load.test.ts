import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUploadProfiles } from '@/components/upload-profiles/profile-picker'

// Keeps hook state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as unknown[][],
  effectCursor: 0,
  cleanups: [] as (() => void)[],
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
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
  // Like React: an effect runs again only when its dependencies change.
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = harness.effectCursor++
    const previous = harness.effects[index]
    if (previous?.every((value, at) => Object.is(value, deps[at]))) return
    harness.effects[index] = deps
    const cleanup = effect()
    if (cleanup) harness.cleanups.push(cleanup)
  },
}))

const fetchMock = vi.fn<typeof fetch>()

function render() {
  harness.cursor = 0
  harness.effectCursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useUploadProfiles()
}

/** Unmounts the hook so the next render mounts it again. */
function unmount() {
  for (const cleanup of harness.cleanups.splice(0)) cleanup()
  harness.slots = []
  harness.effects = []
}

beforeEach(() => {
  unmount()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

describe('loading upload profiles', () => {
  it('reads the profiles from the answer', async () => {
    const profiles = {
      profiles: [],
      defaultProfileId: null,
      accountOptions: {},
      effective: {},
      canShare: true,
    }
    fetchMock.mockResolvedValueOnce(Response.json({ data: profiles }))
    render()
    await vi.waitFor(() => expect(render().data).toEqual(profiles))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload-profiles',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('keeps its own message for a refusal and passes network failures through', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Permission denied' }, { status: 403 })
    )
    render()
    await vi.waitFor(() =>
      expect(render().error).toBe('Could not load upload profiles.')
    )

    unmount()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render()
    await vi.waitFor(() => expect(render().error).toBe('Failed to fetch'))
  })
})
