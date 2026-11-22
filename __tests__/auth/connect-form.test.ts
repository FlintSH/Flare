// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ATTENTION_MS } from '@/components/auth/attention'
import { ConnectForm } from '@/components/auth/connect-form'

import { API_SCOPES } from '@/lib/integrations/bearer-routes'

vi.mock('next/image', () => ({ default: () => null }))

type Props = Parameters<typeof ConnectForm>[0]
const available = API_SCOPES.filter((scope) => scope !== 'mcp')
const props = (changes: Partial<Props> = {}): Props => ({
  request: 'request.signature',
  clientName: 'Claude Code',
  destination: { kind: 'device' },
  account: 'Alex',
  available,
  ceiling: available,
  ...changes,
})

describe('the consent form as the server sends it', () => {
  const form = (changes?: Partial<Props>) =>
    renderToStaticMarkup(createElement(ConnectForm, props(changes)))
  /** The whole tag of the button with this label. */
  const button = (page: string, label: string) => {
    const match = new RegExp(`<button[^>]*>${label}</button>`).exec(page)
    if (!match) throw new Error(`no ${label} button in the page`)
    return match[0]
  }

  it('arrives with Allow marked unavailable and nothing that acts without script', () => {
    const page = form()
    // Marked for assistive technology and drawn as off, yet still in the
    // tab order: it is not turned off.
    expect(button(page, 'Allow')).toContain('aria-disabled="true"')
    expect(button(page, 'Allow')).not.toContain(' disabled=""')
    expect(button(page, 'Cancel')).not.toContain('aria-disabled')
    expect(button(page, 'Cancel')).not.toContain(' disabled=""')
    // Before the script runs a press can do nothing: both are plain buttons
    // outside any form, and no link or address stands in for them.
    expect(button(page, 'Allow')).toContain('type="button"')
    expect(button(page, 'Cancel')).toContain('type="button"')
    expect(page).not.toMatch(/<form|<a |action=|formaction=|href=|onclick=/i)
  })

  it('shows what is asking, where it returns to and for which account', () => {
    const page = form({
      clientName: '<b>Cursor</b>',
      destination: { kind: 'app', scheme: 'cursor://' },
    })
    // The name is text: its markup arrives escaped.
    expect(page).toContain('&lt;b&gt;Cursor&lt;/b&gt;')
    expect(page).not.toContain('<b>Cursor</b>')
    expect(page).toContain('an app on this device (cursor://)')
    expect(page).toContain('Alex')
    expect(
      form({ destination: { kind: 'site', host: 'claude.ai' } })
    ).toContain('claude.ai')
  })

  it('offers only Cancel to an account that can be granted nothing', () => {
    const unpermitted = form({ available: null })
    expect(unpermitted).not.toContain('>Allow<')
    expect(button(unpermitted, 'Cancel')).not.toContain(' disabled=""')
    expect(unpermitted).not.toContain('Allowed actions')

    const none = form({ available: [] })
    expect(none).not.toContain('>Allow<')
    expect(none).toContain(
      'Your role allows no file or short link actions, so there is nothing to allow.'
    )
    expect(
      form({ available: ['files:read'], ceiling: ['files:delete'] })
    ).toContain(
      'Your role allows none of the actions this agent asked for, so there is nothing to allow.'
    )
  })
})

describe('the consent form in the browser', () => {
  const fetchMock = vi.fn()
  // jsdom cannot leave a page, so where the form sends the browser is
  // recorded instead.
  const assign = vi.fn()
  let visible = true
  let focused = true

  const allow = () =>
    screen.getByRole('button', { name: /^(Allow|Connecting…)$/ })
  const cancel = () =>
    screen.getByRole('button', { name: /^(Cancel|Cancelling…)$/ })
  const unavailable = (element: HTMLElement) =>
    element.getAttribute('aria-disabled') === 'true'
  const off = (element: HTMLElement) => (element as HTMLButtonElement).disabled
  const show = (changes?: Partial<Props>) =>
    render(createElement(ConnectForm, props(changes)))
  const pass = (milliseconds: number) =>
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  /** Lets the answer to a request arrive and the form draw what follows. */
  const settle = () => act(async () => {})
  const blur = () => {
    focused = false
    window.dispatchEvent(new Event('blur'))
  }
  const focus = () => {
    focused = true
    window.dispatchEvent(new Event('focus'))
  }
  const restore = (persisted: boolean) =>
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }))
  /** What each request to the server carried. */
  const sent = () =>
    fetchMock.mock.calls.map(([path, init]) => ({
      path,
      ...JSON.parse(init.body),
    }))
  const answerWith = (redirect: string) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ redirect }), { status: 200 })
    )
  /** A request that is still on its way. */
  const hang = () => fetchMock.mockReturnValue(new Promise(() => {}))

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('location', { assign })
    visible = true
    focused = true
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fetchMock.mockReset()
    assign.mockReset()
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('ignores Allow until the page has been in front for the wait', () => {
    hang()
    show()
    expect(unavailable(allow())).toBe(true)
    expect(off(allow())).toBe(false)
    fireEvent.click(allow())
    pass(ATTENTION_MS - 1)
    expect(unavailable(allow())).toBe(true)
    fireEvent.click(allow())
    expect(fetchMock).not.toHaveBeenCalled()

    pass(1)
    expect(unavailable(allow())).toBe(false)
    fireEvent.click(allow())
    expect(sent()).toEqual([
      {
        path: '/api/oauth/authorize',
        request: 'request.signature',
        decision: 'approve',
        scopes: ['files:upload', 'files:read', 'files:content', 'urls:read'],
      },
    ])
    // While the answer is on its way both buttons are off for real.
    expect(allow().textContent).toContain('Connecting…')
    expect(off(allow())).toBe(true)
    expect(off(cancel())).toBe(true)
  })

  it('never makes Cancel wait', () => {
    hang()
    show()
    expect(unavailable(cancel())).toBe(false)
    fireEvent.click(cancel())
    expect(sent()).toMatchObject([{ decision: 'deny' }])
  })

  it('keeps the keyboard on Allow while the page is away, and ignores it until the wait has passed again', () => {
    hang()
    show()
    pass(ATTENTION_MS)
    allow().focus()
    expect(document.activeElement).toBe(allow())

    act(blur)
    // Unavailable, yet still where the keyboard is.
    expect(unavailable(allow())).toBe(true)
    expect(off(allow())).toBe(false)
    expect(document.activeElement).toBe(allow())
    fireEvent.click(allow())
    pass(60_000)
    fireEvent.click(allow())

    act(focus)
    expect(document.activeElement).toBe(allow())
    fireEvent.click(allow())
    pass(ATTENTION_MS - 1)
    fireEvent.click(allow())
    expect(fetchMock).not.toHaveBeenCalled()
    pass(1)
    expect(unavailable(allow())).toBe(false)
    fireEvent.click(allow())
    expect(sent()).toMatchObject([{ decision: 'approve' }])
  })

  it('ignores a press that arrives before the form has been drawn again', () => {
    hang()
    show()
    pass(ATTENTION_MS)
    const button = allow()
    // The page loses focus and is pressed in the same breath: the button
    // on screen still says it can be pressed.
    act(() => {
      blur()
      expect(unavailable(button)).toBe(false)
      button.click()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(unavailable(allow())).toBe(true)

    // The same when it is hidden.
    act(focus)
    pass(ATTENTION_MS)
    act(() => {
      visible = false
      document.dispatchEvent(new Event('visibilitychange'))
      allow().click()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is usable again when the browser brings it back from its cache mid-decision', async () => {
    hang()
    show()
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    expect(allow().textContent).toContain('Connecting…')

    // An ordinary showing of the page leaves a decision in flight alone.
    act(() => {
      restore(false)
    })
    expect(off(allow())).toBe(true)
    expect(off(cancel())).toBe(true)

    act(() => {
      restore(true)
    })
    expect(allow().textContent).toBe('Allow')
    expect(off(allow())).toBe(false)
    expect(off(cancel())).toBe(false)
    // Shown again, it waits again.
    expect(unavailable(allow())).toBe(true)
    fireEvent.click(allow())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    expect(sent()).toMatchObject([
      { decision: 'approve' },
      { decision: 'approve' },
    ])
    await settle()
  })

  it('says what happened after sending an app the answer, and how to try again', async () => {
    answerWith('cursor://anysphere.cursor-mcp/oauth/callback?code=1')
    show({ destination: { kind: 'app', scheme: 'cursor://' } })
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    await settle()
    expect(assign.mock.calls).toEqual([
      ['cursor://anysphere.cursor-mcp/oauth/callback?code=1'],
    ])
    expect(screen.getByRole('status').textContent).toBe(
      'Allowed. You can close this tab. If the app did not open, reload this page and allow again.'
    )
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('Allowed actions')).toBeNull()

    // Back from the cache, the form is there to use again.
    act(() => {
      restore(true)
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(allow().textContent).toBe('Allow')
    expect(off(cancel())).toBe(false)
    expect(screen.getByText('Allowed actions')).toBeTruthy()
  })

  it('follows the answer to a website or this device and stays off while the browser leaves', async () => {
    answerWith('http://localhost:53124/callback?code=1&state=s')
    show()
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    await settle()
    expect(assign.mock.calls).toEqual([
      ['http://localhost:53124/callback?code=1&state=s'],
    ])
    // That page answers for itself; nothing is said here.
    expect(screen.queryByRole('status')).toBeNull()
    expect(allow().textContent).toContain('Connecting…')
    expect(off(allow())).toBe(true)
    expect(off(cancel())).toBe(true)

    // Going back can find it like this: see the cache test above.
    act(() => {
      restore(true)
    })
    expect(allow().textContent).toBe('Allow')
    expect(off(cancel())).toBe(false)
  })

  it('says only that it was cancelled after a Cancel sent to an app', async () => {
    answerWith(
      'cursor://anysphere.cursor-mcp/oauth/callback?error=access_denied'
    )
    show({ destination: { kind: 'app', scheme: 'cursor://' } })
    fireEvent.click(cancel())
    await settle()
    expect(screen.getByRole('status').textContent).toBe(
      'Cancelled. You can close this tab.'
    )
  })

  it("shows the server's reason when it refuses, and can be tried again", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            'This sign-in request has expired. Go back to the app and connect again.',
        }),
        { status: 400 }
      )
    )
    show()
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(
      'This sign-in request has expired. Go back to the app and connect again.'
    )
    expect(off(allow())).toBe(false)
    expect(unavailable(allow())).toBe(false)
  })

  it('never follows an address the browser would run', async () => {
    answerWith('javascript:alert(1)')
    show()
    pass(ATTENTION_MS)
    fireEvent.click(allow())
    await settle()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not finish the connection. Try again.'
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
