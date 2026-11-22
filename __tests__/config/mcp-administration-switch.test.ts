// @vitest-environment jsdom
import { createElement } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstanceSettings } from '@/components/settings/instance-settings'

import { DEFAULT_CONFIG, type FlareConfig } from '@/lib/config'

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { id: 'operator', permissions: session.permissions } },
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/dashboard/settings',
  useSearchParams: () => new URLSearchParams('section=access'),
}))
vi.mock('next/image', () => ({ default: () => null }))
// The appearance studio loads its own data and plays no part here.
vi.mock('@/components/customization/customization-studio', () => ({
  CustomizationStudio: () => null,
}))
vi.mock('@/components/email/email-settings', () => ({
  EmailSettings: () => null,
}))

const SWITCH = 'Allow administration through MCP'
const fetchMock = vi.fn()

function config(mcp: { enabled: boolean; administration: boolean }) {
  const value: FlareConfig = structuredClone(DEFAULT_CONFIG)
  value.settings.general.mcp = mcp
  return value
}
function show(mcp = { enabled: true, administration: true }) {
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(InstanceSettings, {
        initialConfig: config(mcp),
        initialSection: 'access',
        buildInfo: {
          version: '3.1.0',
          channel: 'stable',
          commitSha: null,
          commitUrl: null,
        },
      })
    )
  )
}
const administration = () => screen.queryByRole('switch', { name: SWITCH })
const save = () =>
  act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: /^Save/ })[0])
  })
/** The settings each PATCH sent. */
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body).settings)

beforeEach(() => {
  session.permissions = ['administrator']
  // The screen opens the section the address names.
  window.history.replaceState(null, '', '/dashboard/settings?section=access')
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    () =>
      ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }) as unknown as MediaQueryList
  )
  fetchMock.mockReset()
  toast.mockReset()
  fetchMock.mockResolvedValue(Response.json({ data: {} }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the administration through MCP switch', () => {
  it('is there only while the MCP server is on', () => {
    show({ enabled: false, administration: true })
    expect(administration()).toBeNull()
    fireEvent.click(
      screen.getByRole('switch', { name: 'Enable the MCP server' })
    )
    expect(administration()).toBeTruthy()
  })

  it('is off, with the reason, for someone who manages access but is not an administrator', () => {
    session.permissions = ['settings.read', 'settings.security']
    show()
    expect((administration() as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText(/Only an administrator can change this\./)
    ).toBeTruthy()
    // The server switch beside it stays theirs to change.
    expect(
      (
        screen.getByRole('switch', {
          name: 'Enable the MCP server',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it('gives an administrator no reason, only the switch', () => {
    show()
    expect((administration() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/Only an administrator/)).toBeNull()
  })

  it('asks before turning a saved grant off, and Cancel keeps it', async () => {
    show()
    fireEvent.click(administration()!)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Turn off administration through MCP?')
    expect(dialog.textContent).toContain(
      'When you save, every agent connection and token loses its administration permissions. Turning this on again does not give them back.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(administration()!.getAttribute('aria-checked')).toBe('true')
  })

  it('turns off on confirmation and saves with the other settings', async () => {
    show()
    fireEvent.click(administration()!)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(administration()!.getAttribute('aria-checked')).toBe('false')
    expect(fetchMock).not.toHaveBeenCalled()
    await save()
    // Only the field that changed, which the server checks against the
    // administrator permission.
    expect(patches()).toEqual([{ general: { mcp: { administration: false } } }])
  })

  it('turns on without asking', async () => {
    show({ enabled: true, administration: false })
    fireEvent.click(administration()!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(administration()!.getAttribute('aria-checked')).toBe('true')
    // Off again before saving takes nothing away, so nothing to confirm.
    fireEvent.click(administration()!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it("shows the server's reason when the save is refused", async () => {
    show({ enabled: true, administration: false })
    fetchMock.mockResolvedValue(
      Response.json(
        { error: 'You do not have permission to change these settings.' },
        { status: 403 }
      )
    )
    fireEvent.click(administration()!)
    await save()
    expect(toast).toHaveBeenCalledWith({
      title: 'Settings could not be saved',
      description: 'You do not have permission to change these settings.',
      variant: 'destructive',
    })
  })
})
