import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useOcr } from '@/hooks/use-ocr'

// Keeps hook state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots))
      harness.slots[index] = typeof initial === 'function' ? initial() : initial
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
  // Effects run once, when the hook first mounts.
  useEffect: (effect: () => void | (() => void)) => {
    const index = harness.cursor++
    if (index in harness.slots) return
    harness.slots[index] = true
    const cleanup = effect()
    if (cleanup) harness.cleanups.push(cleanup)
  },
  useContext: () => null,
}))

const fetchMock = vi.fn<typeof fetch>()

function render() {
  harness.cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useOcr('/api/files/cmfile0001/ocr')
}

/** Asks for text and answers with `response`; resolves to the hook after. */
async function extract(response: Response | Error) {
  if (response instanceof Error) fetchMock.mockRejectedValueOnce(response)
  else fetchMock.mockResolvedValueOnce(response)
  await render().extract()
  return render()
}

beforeEach(() => {
  harness.slots = []
  harness.cleanups = []
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('extracting text from an image', () => {
  it('opens the dialog with the text once Flare answers', async () => {
    let answer!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => (answer = resolve))
    )
    const pending = render().extract()
    // The card and the share page show their own progress meanwhile.
    expect(render()).toMatchObject({
      loading: true,
      dialog: { isOpen: false },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/files/cmfile0001/ocr',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
    )
    answer(Response.json({ success: true, text: 'Receipt', confidence: 91 }))
    await pending
    const { loading, dialog } = render()
    expect(loading).toBe(false)
    expect(dialog).toMatchObject({
      isOpen: true,
      isLoading: false,
      text: 'Receipt',
      confidence: 91,
      error: null,
      notice: null,
      onRetry: undefined,
    })
  })

  it('offers another attempt only when one can help', async () => {
    const refused = await extract(
      Response.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    )
    expect(refused.dialog).toMatchObject({ error: 'Unauthorized' })
    expect(refused.dialog.onRetry).toBeUndefined()

    const limited = await extract(
      Response.json(
        { success: false, error: 'Try again in 2 minutes.' },
        { status: 429, headers: { 'Retry-After': '120' } }
      )
    )
    expect(limited.dialog.error).toBe('Try again in 2 minutes.')
    expect(limited.dialog.onRetry).toBeTypeOf('function')

    const reading = await extract(
      Response.json(
        { success: false, status: 'processing', error: 'Still reading.' },
        { status: 202 }
      )
    )
    expect(reading.dialog).toMatchObject({ notice: 'Still reading.' })
    expect(reading.dialog.onRetry).toBeTypeOf('function')

    const offline = await extract(new TypeError('Failed to fetch'))
    expect(offline.dialog.error).toBe(
      'Couldn’t extract text. Please try again.'
    )
    expect(offline.dialog.onRetry).toBeTypeOf('function')
  })

  it('does nothing once the component that asked has gone', async () => {
    let answer!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => (answer = resolve))
    )
    const pending = render().extract()
    harness.cleanups.forEach((cleanup) => cleanup())
    answer(Response.json({ success: true, text: 'Receipt', confidence: 91 }))
    await pending
    expect(render().dialog.isOpen).toBe(false)
  })
})
