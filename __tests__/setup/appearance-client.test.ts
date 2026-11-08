import type { ReactElement, ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SetupAppearance } from '@/components/setup/setup-appearance'
import { AlertDescription } from '@/components/ui/alert'

import { DEFAULT_CUSTOMIZATION } from '@/lib/customization/schema'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => (() => void) | void>,
  fetch: vi.fn<typeof fetch>(),
  complete: vi.fn(),
  skip: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'setup-appearance-test',
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
  useEffect: (effect: () => (() => void) | void) => {
    harness.effects.push(effect)
  },
}))
type Element = ReactElement<Record<string, unknown>>
function find(
  node: ReactNode,
  matches: (node: Element) => boolean
): Element | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, matches)).find(Boolean)
  if (!node || typeof node !== 'object' || !('props' in node)) return
  const element = node as Element
  return matches(element)
    ? element
    : find(element.props.children as ReactNode, matches)
}
function render() {
  harness.cursor = 0
  harness.effects = []
  return SetupAppearance({ onComplete: harness.complete, onSkip: harness.skip })
}
function mount() {
  render()
  return harness.effects[0]()
}
const errorMessage = () =>
  find(render(), (e) => e.type === AlertDescription)?.props.children
const submitButton = () => find(render(), (e) => e.props.type === 'submit')!
function publish() {
  const form = render()
  ;(form.props.onSubmit as (event: { preventDefault(): void }) => void)({
    preventDefault() {},
  })
}
async function load() {
  harness.fetch.mockResolvedValueOnce(
    Response.json({ data: DEFAULT_CUSTOMIZATION })
  )
  mount()
  await vi.waitFor(() => expect(submitButton().props.disabled).toBe(false))
}
const connectionMessage =
  'Connection problem. Check the result before trying again.'
beforeEach(() => {
  harness.slots = []
  harness.effects = []
  harness.fetch.mockReset()
  harness.complete.mockReset()
  harness.skip.mockReset()
  vi.stubGlobal('fetch', harness.fetch)
})
afterEach(() => vi.unstubAllGlobals())

describe('setup appearance transport recovery', () => {
  it('shows connection recovery without retrying the initial uncached load', async () => {
    harness.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mount()
    await vi.waitFor(() => expect(errorMessage()).toBe(connectionMessage))
    expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/customization',
      {
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }
    )
    expect(harness.complete).not.toHaveBeenCalled()
  })

  it('does not expose an interrupted JSON body as raw network text', async () => {
    const response = Response.json({ data: DEFAULT_CUSTOMIZATION })
    vi.spyOn(response, 'text').mockRejectedValueOnce(
      new TypeError('terminated')
    )
    harness.fetch.mockResolvedValueOnce(response)
    mount()
    await vi.waitFor(() => expect(errorMessage()).toBe(connectionMessage))
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.fetch).toHaveBeenCalledOnce()
  })

  it('does not publish stale load errors after unmount cancellation', async () => {
    let reject!: (error: unknown) => void
    harness.fetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    const cleanup = mount()
    expect(typeof cleanup).toBe('function')
    if (typeof cleanup === 'function') cleanup()
    const signal = harness.fetch.mock.calls[0][1]!.signal!
    expect(signal.aborted).toBe(true)
    reject(new TypeError('Failed to fetch'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errorMessage()).toBeUndefined()
    expect(harness.complete).not.toHaveBeenCalled()
  })

  it('preserves a human HTTP refusal rather than relabeling it as transport', async () => {
    harness.fetch.mockResolvedValueOnce(
      Response.json(
        { error: 'Appearance is locked by the operator.' },
        { status: 403 }
      )
    )
    mount()
    await vi.waitFor(() =>
      expect(errorMessage()).toBe('Appearance is locked by the operator.')
    )
    expect(harness.fetch).toHaveBeenCalledOnce()
  })

  it('keeps schema validation outside the transport failure boundary', async () => {
    harness.fetch.mockResolvedValueOnce(
      Response.json({ data: { revision: -1 } })
    )
    mount()
    await vi.waitFor(() => expect(String(errorMessage())).toContain('revision'))
    expect(errorMessage()).not.toBe(connectionMessage)
    expect(harness.complete).not.toHaveBeenCalled()
  })

  it('keeps409 conflict guidance and reload even when the body cannot be read', async () => {
    await load()
    const response = new Response(null, { status: 409 })
    const read = vi
      .spyOn(response, 'text')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    harness.fetch.mockResolvedValueOnce(response)
    publish()
    await vi.waitFor(() =>
      expect(errorMessage()).toBe(
        'Appearance changed in another tab. Reload the latest appearance, then review your choices before saving.'
      )
    )
    expect(
      find(render(), (e) => e.props.children === 'Reload latest appearance')
    ).toBeDefined()
    expect(submitButton().props.disabled).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(harness.complete).not.toHaveBeenCalled()
  })

  it('does not claim publication or retry after a connection failure', async () => {
    await load()
    harness.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    publish()
    await vi.waitFor(() => expect(errorMessage()).toBe(connectionMessage))
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(submitButton().props.disabled).toBe(false)
    expect(
      find(render(), (e) => e.props.id === 'setup-appearance-test-name')!.props
        .value
    ).toBe(DEFAULT_CUSTOMIZATION.published.brand.name)
  })

  it('preserves the actual publish payload and completes only after a valid acknowledgement', async () => {
    await load()
    harness.fetch.mockResolvedValueOnce(
      Response.json({ data: { ...DEFAULT_CUSTOMIZATION, revision: 1 } })
    )
    publish()
    await vi.waitFor(() => expect(harness.complete).toHaveBeenCalledOnce())
    expect(harness.fetch).toHaveBeenLastCalledWith('/api/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    })
    expect(JSON.parse(harness.fetch.mock.calls[1][1]!.body as string)).toEqual({
      action: 'publish',
      revision: 0,
      document: DEFAULT_CUSTOMIZATION.published,
    })
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })
})
