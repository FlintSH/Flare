import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUserManagement } from '@/hooks/use-user-management'

// Keep hook state across explicit renders without requiring a browser renderer.
// Network completion and abort timing remain under the test's control.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  fetch: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
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
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: harness.refresh }),
}))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: harness.toast }),
}))

function render(search = '') {
  harness.cursor = 0
  return useUserManagement({ search })
}

function listResponse(name: string) {
  return Response.json({
    data: [{ id: name, name }],
    pagination: { page: 1, pageCount: 1, total: 1, limit: 25 },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.slots = []
  vi.stubGlobal('fetch', harness.fetch)
})

afterEach(() => vi.unstubAllGlobals())

describe('user-list loading ownership', () => {
  it('keeps overlapping avatar mutations loading until both finish', async () => {
    harness.fetch.mockResolvedValueOnce(listResponse('Existing user'))
    await render().fetchUsers()
    let finishFirst!: (response: Response) => void
    let finishSecond!: (response: Response) => void
    harness.fetch
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishSecond = resolve
          })
      )
    const first = render().removeUserAvatar('first')
    const second = render().removeUserAvatar('second')
    finishFirst(new Response(null, { status: 204 }))
    await first
    expect(render().isLoading).toBe(true)
    finishSecond(new Response(null, { status: 204 }))
    await second
    expect(render().isLoading).toBe(false)
  })

  it.each(['create', 'update', 'delete'] as const)(
    'keeps a replacement query loading after an aborted %s refresh settles',
    async (operation) => {
      harness.fetch.mockResolvedValueOnce(listResponse('Existing user'))
      await render().fetchUsers()
      expect(render().isLoading).toBe(false)

      harness.fetch.mockResolvedValueOnce(
        Response.json({ data: { id: 'created' } })
      )
      let refreshStarted!: () => void
      const started = new Promise<void>((resolve) => {
        refreshStarted = resolve
      })
      harness.fetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
            refreshStarted()
          })
      )
      const hook = render()
      const form = {
        name: 'New user',
        email: 'new@example.test',
        role: 'USER' as const,
      }
      const mutation =
        operation === 'create'
          ? hook.createUser(form)
          : operation === 'update'
            ? hook.updateUser('existing', form)
            : hook.deleteUser('existing')
      await started

      let completeReplacement!: (response: Response) => void
      harness.fetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeReplacement = resolve
          })
      )
      const replacement = render('Matching').fetchUsers()
      await mutation

      expect(harness.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('search=Matching'),
        expect.anything()
      )
      expect(render('Matching').isLoading).toBe(true)
      completeReplacement(listResponse('Matching user'))
      await replacement
      expect(render('Matching').isLoading).toBe(false)
      expect(render('Matching').users[0].name).toBe('Matching user')
    }
  )
})
