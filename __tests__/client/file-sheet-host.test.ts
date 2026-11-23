// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileSheetHost } from '@/components/file/sheet/file-sheet-host'

import { openFileSheet } from '@/lib/client/file-sheet'

const code = vi.hoisted(() => ({ ready: () => Promise.resolve() }))
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

// The sheets themselves are stand-ins: a button that asks to close.
vi.mock('@/components/shared/on-demand', () => ({
  onDemand: () => {
    const Stand = (props: { id: string; onClose: () => void }) =>
      createElement('button', { onClick: props.onClose }, `close ${props.id}`)
    Stand.preload = () => {}
    Stand.ready = () => code.ready()
    return Stand
  },
}))

/** Moves the page to `search` the way a navigation would, and redraws. */
function visit(search: string, rerender?: () => void) {
  window.history.replaceState(null, '', `/dashboard/upload${search}`)
  if (rerender) act(rerender)
}

beforeEach(() => {
  vi.clearAllMocks()
  code.ready = () => Promise.resolve()
  visit('')
})
afterEach(() => cleanup())

describe('FileSheetHost', () => {
  it('goes back when closing a sheet it opened, so Back does not reopen it', () => {
    const { rerender } = render(createElement(FileSheetHost))
    act(() => openFileSheet('a'))
    // Written straight to the history, no server round trip.
    expect(window.location.search).toBe('?file=a')
    visit('?file=a', () => rerender(createElement(FileSheetHost)))
    fireEvent.click(screen.getByText('close a'))
    expect(router.back).toHaveBeenCalledOnce()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('carries the library’s place, not Next’s markers, into the sheet’s entry', () => {
    const place = { filterKey: 'k', index: 700 }
    window.history.replaceState(
      { __NA: true, flareFileLibrary: place },
      '',
      '/dashboard'
    )
    render(createElement(FileSheetHost))
    act(() => openFileSheet('a'))
    expect(window.history.state).toEqual({ flareFileLibrary: place })
  })

  it('goes back once however often a closing sheet is closed', () => {
    const { rerender } = render(createElement(FileSheetHost))
    act(() => openFileSheet('a'))
    visit('?file=a', () => rerender(createElement(FileSheetHost)))
    const close = screen.getByText('close a')
    fireEvent.click(close)
    fireEvent.click(close)
    expect(router.back).toHaveBeenCalledOnce()
  })

  it('swaps the address when closing a sheet opened from its address', () => {
    visit('?file=a')
    render(createElement(FileSheetHost))
    fireEvent.click(screen.getByText('close a'))
    expect(router.back).not.toHaveBeenCalled()
    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/upload'
    )
  })

  it('ignores a late close from a sheet no longer shown', () => {
    visit('?file=a')
    render(createElement(FileSheetHost))
    const close = screen.getByText('close a')
    // The address has moved on (another file), but this sheet's close runs.
    window.history.replaceState(null, '', '/dashboard/upload?file=b')
    fireEvent.click(close)
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('replaces rather than stacks a sheet opened over another', () => {
    visit('?file=a')
    render(createElement(FileSheetHost))
    const entries = window.history.length
    act(() => openFileSheet('b'))
    expect(window.location.search).toBe('?file=b')
    expect(window.history.length).toBe(entries)
  })

  it('says so, and tries again, when the sheet’s code can’t be fetched', async () => {
    let fails = true
    code.ready = () =>
      fails ? Promise.reject(new Error('offline')) : Promise.resolve()
    visit('?file=a')
    render(createElement(FileSheetHost))
    expect(await screen.findByText('Couldn’t open it')).toBeTruthy()
    fails = false
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByText('close a')).toBeTruthy()
  })
})
