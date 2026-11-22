import { type ReactElement, isValidElement } from 'react'

import ConnectPage from '@/app/(main)/auth/connect/page'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectForm } from '@/components/auth/connect-form'

import { ADMIN_SCOPES } from '@/lib/integrations/bearer-routes'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  administrationOn: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth/page-session', () => ({ getPageSession: mocks.session }))
vi.mock('@/lib/mcp/settings', () => ({
  mcpEnabled: async () => true,
  administrationOn: mocks.administrationOn,
}))
vi.mock('@/lib/oauth/authorize', () => ({
  readConsentRequest: () => ({
    userId: 'alex',
    clientName: 'Claude Code',
    redirectUri: 'http://localhost:53124/callback',
    scopeCeiling: ['files:read', 'admin:read'],
  }),
}))

/** The props the page gives the consent form. */
async function formProps(permissions: string[]) {
  mocks.session.mockResolvedValue({
    user: { id: 'alex', name: 'Alex', permissions },
  })
  const page = await ConnectPage({
    searchParams: Promise.resolve({ request: 'request.signature' }),
  })
  const find = (node: unknown): ReactElement | null => {
    if (!isValidElement(node)) return null
    if (node.type === ConnectForm) return node
    const { children } = node.props as { children?: unknown }
    for (const child of [children].flat()) {
      const found = find(child)
      if (found) return found
    }
    return null
  }
  return find(page)!.props as Parameters<typeof ConnectForm>[0]
}

beforeEach(() => vi.clearAllMocks())

describe('the consent page', () => {
  it('offers the administration scopes only while administration through MCP is on', async () => {
    mocks.administrationOn.mockResolvedValue(true)
    expect((await formProps(['administrator'])).available).toEqual(
      expect.arrayContaining([...ADMIN_SCOPES])
    )
    mocks.administrationOn.mockResolvedValue(false)
    const off = (await formProps(['administrator'])).available!
    expect(off).toContain('files:read')
    expect(off.filter((scope) => scope.startsWith('admin:'))).toEqual([])
  })

  it('offers only what the role allows, even while it is on', async () => {
    mocks.administrationOn.mockResolvedValue(true)
    const available = (
      await formProps(['tokens.manage', 'files.read', 'users.read'])
    ).available!
    expect(available).toContain('admin:read')
    expect(available).not.toContain('admin:users')
    expect(available).not.toContain('admin:settings')
  })

  it('does not ask for an account that may not connect agents', async () => {
    mocks.administrationOn.mockResolvedValue(true)
    expect((await formProps(['files.read'])).available).toBeNull()
    expect(mocks.administrationOn).not.toHaveBeenCalled()
  })
})
