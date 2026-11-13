// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onDemand } from '@/components/shared/on-demand'

const toast = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ toast }))

function Dialog({ title }: { title: string }) {
  return createElement('p', null, title)
}

/** A loader whose requests the test settles by hand. */
function loader() {
  const requests: {
    resolve: (component: typeof Dialog) => void
    reject: (error: Error) => void
  }[] = []
  const load = vi.fn(
    () =>
      new Promise<typeof Dialog>((resolve, reject) =>
        requests.push({ resolve, reject })
      )
  )
  return { load, requests }
}

afterEach(() => {
  cleanup()
  toast.mockClear()
})

describe('onDemand', () => {
  it('renders nothing and fetches nothing until asked', () => {
    const { load } = loader()
    const Lazy = onDemand(load)
    const { container } = render(createElement(Lazy, { title: 'Move files' }))
    expect(container.innerHTML).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('opens once the code arrives, and at once from then on', async () => {
    const { load, requests } = loader()
    const Lazy = onDemand(load)
    render(createElement(Lazy, { title: 'Move files' }))
    const open = vi.fn()

    Lazy.show(open)
    expect(open).not.toHaveBeenCalled()
    await act(async () => requests[0].resolve(Dialog))
    expect(open).toHaveBeenCalledTimes(1)
    // A component that was already on the page shows its dialog too.
    expect(screen.getByText('Move files')).toBeTruthy()

    Lazy.show(open)
    expect(open).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shares one request between a preload and the click after it', async () => {
    const { load, requests } = loader()
    const Lazy = onDemand(load)
    const open = vi.fn()

    Lazy.preload()
    Lazy.preload()
    Lazy.show(open)
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => requests[0].resolve(Dialog))
    expect(open).toHaveBeenCalledTimes(1)

    Lazy.preload()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('says so when the code can’t be fetched, and asks again next time', async () => {
    const { load, requests } = loader()
    const Lazy = onDemand(load)
    const open = vi.fn()

    Lazy.show(open)
    await act(async () => requests[0].reject(new Error('offline')))
    expect(open).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Couldn’t open that' })
    )

    Lazy.show(open)
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => requests[1].resolve(Dialog))
    expect(open).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('opens only what was asked for last when two wait for their code', async () => {
    const first = loader()
    const second = loader()
    const Tags = onDemand(first.load)
    const Move = onDemand(second.load)
    const openTags = vi.fn()
    const openMove = vi.fn()

    Tags.show(openTags)
    Move.show(openMove)
    await act(async () => first.requests[0].resolve(Dialog))
    await act(async () => second.requests[0].resolve(Dialog))
    expect(openTags).not.toHaveBeenCalled()
    expect(openMove).toHaveBeenCalledTimes(1)
  })

  it('does not open after something that was already here was opened', async () => {
    const slow = loader()
    const ready = loader()
    const Slow = onDemand(slow.load)
    const Ready = onDemand(ready.load)
    Ready.preload()
    await act(async () => ready.requests[0].resolve(Dialog))
    const openSlow = vi.fn()
    const openReady = vi.fn()

    Slow.show(openSlow)
    Ready.show(openReady)
    expect(openReady).toHaveBeenCalledTimes(1)
    await act(async () => slow.requests[0].resolve(Dialog))
    expect(openSlow).not.toHaveBeenCalled()
  })

  it('does not open, or report a failure, once it is no longer wanted', async () => {
    const { load, requests } = loader()
    const Lazy = onDemand(load)
    const open = vi.fn()
    let wanted = true

    // Asked at the moment the code arrives, not when the click was made.
    Lazy.show(open, () => wanted)
    wanted = false
    await act(async () => requests[0].reject(new Error('offline')))
    expect(toast).not.toHaveBeenCalled()

    Lazy.show(open, () => wanted)
    await act(async () => requests[1].resolve(Dialog))
    expect(open).not.toHaveBeenCalled()

    // What is already here opens at once, as the click that asked for it.
    wanted = true
    Lazy.show(open, () => wanted)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed preload quiet until someone asks to see it', async () => {
    const { load, requests } = loader()
    const Lazy = onDemand(load)

    Lazy.preload()
    await act(async () => requests[0].reject(new Error('offline')))
    expect(toast).not.toHaveBeenCalled()

    Lazy.preload()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
