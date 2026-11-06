import { createElement } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SetupChecker } from '@/components/setup/setup-checker'

import { RefusedRequest } from '@/lib/client/request'

import { useMarkSetupComplete } from '@/hooks/use-setup-status'

const key = ['setup-status']

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  push: vi.fn(),
  options: undefined as
    | {
        initialData?: unknown
        queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
      }
    | undefined,
}))

// Effects run during the render, so a redirect shows up as a router call.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void) => effect(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: ((options) => {
      mocks.options = options as unknown as typeof mocks.options
      return actual.useQuery(options)
    }) as typeof actual.useQuery,
  }
})

let client: QueryClient

function MarkSetupComplete() {
  useMarkSetupComplete()()
  return null
}

/** The page shell as the server renders it: the checker beside a page. */
function render(pathname: string, completed?: boolean) {
  mocks.pathname = pathname
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SetupChecker, { completed }),
      createElement('main', null, 'Your files')
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient()
})

afterEach(() => {
  vi.unstubAllGlobals()
  client.clear()
})

describe('setup checker', () => {
  it('lets the server render every page, whatever setup reports', () => {
    for (const completed of [true, false, undefined]) {
      client = new QueryClient()
      expect(render('/dashboard', completed)).toBe('<main>Your files</main>')
    }
  })

  it('sends pages to setup while the instance has no account', () => {
    render('/dashboard', false)
    expect(mocks.push).toHaveBeenCalledWith('/setup')
  })

  it('leaves a set-up instance where it is', () => {
    render('/dashboard', true)
    render('/auth/login', true)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('never redirects away from setup', () => {
    for (const completed of [false, true]) {
      client = new QueryClient()
      render('/setup', completed)
    }
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('keeps the page when the server could not tell and the check fails', async () => {
    render('/dashboard')
    expect(mocks.push).not.toHaveBeenCalled()
    const outage = new RefusedRequest(
      'Setup status is temporarily unavailable',
      503
    )
    await client.prefetchQuery({
      queryKey: key,
      queryFn: () => Promise.reject(outage),
      retry: false,
    })
    expect(render('/dashboard')).toBe('<main>Your files</main>')
    // A refetch that fails keeps the last answer and its error together.
    client.setQueryData(key, { completed: true })
    await client.prefetchQuery({
      queryKey: key,
      queryFn: () => Promise.reject(outage),
      retry: false,
      staleTime: 0,
    })
    expect(client.getQueryState(key)?.error).toBe(outage)
    render('/auth/login')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe('setup status', () => {
  it('starts from the server answer and asks the browser API only without one', async () => {
    render('/dashboard', true)
    expect(mocks.options?.initialData).toEqual({ completed: true })
    expect(client.getQueryData(key)).toEqual({ completed: true })

    client = new QueryClient()
    render('/dashboard')
    expect(mocks.options?.initialData).toBeUndefined()
    expect(client.getQueryData(key)).toBeUndefined()

    const fetch = vi.fn(async () => Response.json({ completed: false }))
    vi.stubGlobal('fetch', fetch)
    const { signal } = new AbortController()
    await expect(mocks.options!.queryFn({ signal })).resolves.toEqual({
      completed: false,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/setup/check',
      expect.objectContaining({ method: 'GET', signal })
    )
    fetch.mockResolvedValueOnce(
      Response.json(
        { error: 'Setup status is temporarily unavailable' },
        { status: 503 }
      )
    )
    await expect(mocks.options!.queryFn({ signal })).rejects.toMatchObject({
      status: 503,
      message: 'Setup status is temporarily unavailable',
    })
  })

  it('records completion under the status the checker reads', () => {
    render('/setup', false)
    expect(client.getQueryData(key)).toEqual({ completed: false })
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MarkSetupComplete)
      )
    )
    expect(client.getQueryData(key)).toEqual({ completed: true })
    // Later pages keep the browser's answer over the one the page was
    // first rendered with.
    render('/dashboard', false)
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
