import { createElement } from 'react'

import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IntegrationsPanel } from '@/components/integrations/integrations-panel'

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: 'alice',
        sessionId: 'alice-browser',
        permissions: ['tokens.manage', 'webhooks.manage'],
      },
    },
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
let client: QueryClient

const render = (active: boolean) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(IntegrationsPanel, { embedded: true, active })
    )
  )

const integrations = () =>
  client
    .getQueryCache()
    .getAll()
    .find((query) => query.queryKey[0] === 'integrations')!

beforeEach(() => {
  // Each render mounts the panel anew, which would read again after a
  // failure; a panel that stays open keeps showing the error instead.
  client = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
})

describe('the Integrations panel', () => {
  it('reloads every five seconds only while its section is open', () => {
    render(false)
    expect(integrations().options).toMatchObject({
      enabled: false,
      refetchInterval: 5000,
    })
    client.clear()
    render(true)
    expect(integrations().options).toMatchObject({
      enabled: true,
      refetchInterval: 5000,
    })
  })

  it('clears the error of a failed reload once a later one succeeds', async () => {
    render(true)
    const query = integrations()
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Database unavailable' }, { status: 503 })
    )
    const observer = new QueryObserver(client, {
      ...query.options,
      queryKey: query.queryKey,
    })
    const stop = observer.subscribe(() => {})
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true)
    )
    expect(render(true)).toContain('Database unavailable')

    fetchMock.mockResolvedValueOnce(
      Response.json({ tokens: [], webhooks: [], deliveries: [], profiles: [] })
    )
    await observer.refetch()
    expect(render(true)).not.toContain('Database unavailable')
    stop()
  })
})
