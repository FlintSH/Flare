// @vitest-environment jsdom
import { createElement } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectForm } from '@/components/auth/connect-form'
import { ConnectAgentDialog } from '@/components/integrations/connect-agent-dialog'
import {
  type AgentConnection,
  ConnectedAgents,
} from '@/components/integrations/connected-agents'
import { IntegrationsPanel } from '@/components/integrations/integrations-panel'
import {
  ADMINISTRATION_NOTE,
  SIGN_IN_ONLY_REASON,
  ScopePicker,
} from '@/components/integrations/scope-picker'
import {
  ADMIN_LIFETIME_REASON,
  adminConnectionEnd,
  allowedLifetime,
  lifetimeAllowed,
} from '@/components/integrations/shared'
import { TokenLifetime } from '@/components/integrations/token-lifetime'
import { Button } from '@/components/ui/button'
import { DialogTrigger } from '@/components/ui/dialog'

import { ADMIN_SCOPES, API_SCOPES } from '@/lib/integrations/bearer-routes'

const session = vi.hoisted(() => ({
  permissions: ['administrator'] as string[],
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: 'alex',
        sessionId: 'alex-browser',
        permissions: session.permissions,
      },
    },
  }),
}))
vi.mock('next/image', () => ({ default: () => null }))

const ADMIN_LABELS = [
  'View administration',
  'Manage users and roles',
  'Moderate content',
  'Change instance settings',
]
const checkbox = (name: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`^${name}`) })
const group = (name: string) => screen.queryByRole('group', { name })
const pickCustom = () => fireEvent.click(screen.getByLabelText(/^Custom/))

const toLocaleDateString = Date.prototype.toLocaleDateString
/** Dates as a viewer in `locale` sees them, whatever this machine's locale. */
const viewIn = (locale: string) =>
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
    this: Date,
    _locale,
    options
  ) {
    return toLocaleDateString.call(this, locale, options)
  })

beforeEach(() => {
  session.permissions = ['administrator']
  viewIn('en-US')
  // jsdom lays nothing out; the dialogs and Custom's reveal ask it to.
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('when a connection with an administration scope ends', () => {
  it('is 30 days on, with the month spelled in the order of the viewer', () => {
    expect(adminConnectionEnd('2026-11-22T12:00:00Z')).toBe('December 22, 2026')
    viewIn('en-GB')
    expect(adminConnectionEnd('2026-11-22T12:00:00Z')).toBe('22 December 2026')
  })
})

describe('the Administration group', () => {
  const consent = (available: readonly string[]) =>
    render(
      createElement(ConnectForm, {
        request: 'request.signature',
        clientName: 'Claude Code',
        destination: { kind: 'device' },
        account: 'Alex',
        available,
        ceiling: available,
      })
    )
  const everything = API_SCOPES.filter((scope) => scope !== 'mcp')

  it('appears only in Custom, under its sentence, with nothing ticked', () => {
    consent(everything)
    // The presets never hold an administration scope or invites.
    expect(group('Administration')).toBeNull()
    expect(screen.queryByText(ADMINISTRATION_NOTE.connection)).toBeNull()

    pickCustom()
    const admin = group('Administration')!
    expect(admin.getAttribute('aria-describedby')).toBeTruthy()
    expect(within(admin).getByText(ADMINISTRATION_NOTE.connection)).toBeTruthy()
    expect(
      within(admin)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')!.textContent)
    ).toEqual(
      ADMIN_LABELS.map((label) => expect.stringContaining(label) as string)
    )
    for (const label of [...ADMIN_LABELS, 'Manage invites']) {
      expect((checkbox(label) as HTMLInputElement).checked, label).toBe(false)
      expect((checkbox(label) as HTMLInputElement).disabled, label).toBe(false)
    }
    // Manage invites sits with the account's own settings.
    expect(
      within(group('Account')!).getByRole('checkbox', {
        name: /^Manage invites/,
      })
    ).toBeTruthy()
  })

  it('is not there when the server does not offer its scopes', () => {
    consent(everything.filter((scope) => !scope.startsWith('admin:')))
    pickCustom()
    expect(group('Administration')).toBeNull()
    expect(screen.queryByText(/act on other accounts/)).toBeNull()
  })

  it('shows only the scopes offered', () => {
    consent(['files:read', 'admin:read'])
    pickCustom()
    const admin = group('Administration')!
    expect(within(admin).getAllByRole('checkbox')).toHaveLength(1)
    expect((checkbox('View administration') as HTMLInputElement).checked).toBe(
      false
    )
  })

  it('says when the connection would end once one is ticked, on the consent screen', () => {
    vi.useFakeTimers({ now: new Date('2026-11-22T12:00:00Z') })
    try {
      consent(everything)
      pickCustom()
      expect(screen.queryByText(/This connection ends on/)).toBeNull()
      fireEvent.click(checkbox('Moderate content'))
      expect(
        screen.getByText('This connection ends on December 22, 2026.')
      ).toBeTruthy()
      fireEvent.click(checkbox('Moderate content'))
      expect(screen.queryByText(/This connection ends on/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing about 30 days on a token, whose limit sits by its expiry', () => {
    const picker = (administration: boolean) =>
      render(
        createElement(ScopePicker, {
          selected: ['mcp'],
          onChange: () => {},
          can: () => true,
          mcp: true,
          administration,
          credential: 'token',
        })
      )
    picker(true)
    expect(
      within(group('Administration')!).getByText(ADMINISTRATION_NOTE.token)
    ).toBeTruthy()
    expect(screen.queryByText(/30 days/)).toBeNull()
    cleanup()
    // Off on the instance, the token form does not offer them.
    picker(false)
    expect(group('Administration')).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: /^Manage invites/ })
    ).toBeTruthy()
  })
})

describe('the 90-day rule for tokens with an administration scope', () => {
  const lifetime = (value: string, scopes: string[]) =>
    render(
      createElement(TokenLifetime, {
        id: 'expiry',
        value,
        onChange: () => {},
        scopes,
      })
    )
  const select = () => screen.getByRole('combobox') as HTMLSelectElement
  const unavailable = () =>
    [...select().options]
      .filter((option) => option.disabled)
      .map((option) => option.textContent)

  it('offers every lifetime without one', () => {
    lifetime('0', ['mcp', 'files:read', 'invites:write'])
    expect(unavailable()).toEqual([])
    expect(select().value).toBe('0')
    expect(screen.queryByText(ADMIN_LIFETIME_REASON)).toBeNull()
  })

  it('rules out a year and never, says why, and moves a longer choice to 90 days', () => {
    lifetime('365', ['mcp', 'admin:read'])
    expect(unavailable()).toEqual(['1 year', 'Never'])
    expect(select().value).toBe('90')
    const reason = screen.getByText(ADMIN_LIFETIME_REASON)
    expect(select().getAttribute('aria-describedby')).toBe(reason.id)
    cleanup()
    lifetime('30', ['mcp', 'admin:settings'])
    expect(select().value).toBe('30')
  })

  it('sends what it shows', () => {
    for (const scope of ADMIN_SCOPES) {
      expect(allowedLifetime('0', true), scope).toBe('90')
      expect(allowedLifetime('365', true)).toBe('90')
    }
    expect(allowedLifetime('30', true)).toBe('30')
    expect(allowedLifetime('0', false)).toBe('0')
    expect(lifetimeAllowed('90', true)).toBe(true)
    expect(lifetimeAllowed('365', true)).toBe(false)
  })

  it('creates the token from the connect dialog with an expiry the server accepts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { secret: 'flr_secret' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      createElement(
        ConnectAgentDialog,
        // The trigger is the child below.
        {
          url: 'http://localhost:3000/api/mcp',
          administration: true,
          onCreated: () => {},
        } as Parameters<typeof ConnectAgentDialog>[0],
        createElement(
          DialogTrigger,
          { asChild: true },
          createElement(Button, null, 'Connect an agent')
        )
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect an agent' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use a token instead' }))
    fireEvent.change(screen.getByLabelText('Expires after'), {
      target: { value: '0' },
    })
    pickCustom()
    fireEvent.click(checkbox('Manage users and roles'))
    expect(
      (screen.getByLabelText('Expires after') as HTMLSelectElement).value
    ).toBe('90')
    const before = Date.now()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.scopes).toContain('admin:users')
    const days = (Date.parse(body.expiresAt) - before) / 86_400_000
    expect(days).toBeGreaterThan(89.99)
    expect(days).toBeLessThanOrEqual(90.01)
  })
})

describe('connected agents with administration permissions', () => {
  const connection = (scopes: string[]): AgentConnection => ({
    id: `connection-${scopes.length}`,
    clientName: 'Claude Code (flare)',
    returnsTo: 'http://localhost:53124/callback',
    scopes,
    createdAt: '2026-11-17T10:00:00.000Z',
    lastUsedAt: null,
  })
  const list = (
    connections: AgentConnection[],
    { administration = true, onSaved = () => {} } = {}
  ) =>
    render(
      createElement(ConnectedAgents, {
        connections,
        administration,
        onDisconnect: () => {},
        onSaved,
      })
    )

  it('shows when a connection that holds one ends, and nothing for one that does not', () => {
    list([connection(['files:read', 'admin:read']), connection(['files:read'])])
    // In the short form the line's other dates use.
    expect(
      screen.getAllByText('Ends 12/17/2026', { exact: false })
    ).toHaveLength(1)
    // The same day as the consent screen names for the same moment.
    expect(adminConnectionEnd('2026-11-17T10:00:00.000Z')).toBe(
      'December 17, 2026'
    )
    expect(adminConnectionEnd('2026-11-17T10:00:00.000Z', 'list')).toBe(
      '12/17/2026'
    )
  })

  it('lets a held one be unticked, and never adds one the connection lacks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    list([connection(['files:read', 'admin:read'])])
    fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }))
    const held = checkbox('View administration') as HTMLInputElement
    expect(held.checked).toBe(true)
    expect(held.disabled).toBe(false)
    for (const label of ADMIN_LABELS.slice(1)) {
      const box = checkbox(label) as HTMLInputElement
      expect(box.checked, label).toBe(false)
      expect(box.disabled, label).toBe(true)
      expect(
        document.getElementById(box.getAttribute('aria-describedby')!)
          ?.textContent
      ).toBe(SIGN_IN_ONLY_REASON)
    }
    // Other scopes stay free to add.
    expect((checkbox('Manage invites') as HTMLInputElement).disabled).toBe(
      false
    )
    fireEvent.click(held)
    expect(held.checked).toBe(false)
    // Unticked, it can still be ticked again before saving.
    expect(held.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'update-agent',
      id: 'connection-2',
      scopes: ['files:read'],
    })
  })

  it('locks all four on a connection that holds none', () => {
    list([connection(['files:read', 'files:content', 'urls:read'])])
    fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }))
    pickCustom()
    for (const label of ADMIN_LABELS)
      expect((checkbox(label) as HTMLInputElement).disabled, label).toBe(true)
    expect(screen.getAllByText(SIGN_IN_ONLY_REASON)).toHaveLength(4)
  })

  it('offers none while administration through MCP is off', () => {
    list([connection(['files:read'])], { administration: false })
    fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }))
    pickCustom()
    expect(group('Administration')).toBeNull()
  })
})

describe('the Integrations panel passes on whether administration is on', () => {
  const token = {
    id: 'token-1',
    name: 'Admin agent',
    scopes: ['mcp', 'files:read', 'admin:read'],
    profileId: null,
    expiresAt: '2027-01-01T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
  }
  const panel = async (administration: boolean) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          tokens: [token],
          webhooks: [],
          deliveries: [],
          profiles: [],
          mcp: { enabled: true, url: null, administration },
          connections: [],
        })
      )
    )
    const client = new QueryClient()
    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(IntegrationsPanel, { embedded: true })
      )
    )
    await screen.findByText('Admin agent')
  }

  it('to the token list and the token form', async () => {
    await panel(true)
    expect(screen.getByText('View administration')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New token' }))
    fireEvent.click(checkbox('Agent access'))
    expect(group('Administration')).toBeTruthy()
  })

  it('and leaves them out while it is off', async () => {
    await panel(false)
    expect(screen.queryByText('View administration')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New token' }))
    fireEvent.click(checkbox('Agent access'))
    expect(group('Administration')).toBeNull()
  })
})
