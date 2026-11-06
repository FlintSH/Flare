import { createElement } from 'react'

import { QueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SetupChecker } from '@/components/setup/setup-checker'

import { useMarkSetupComplete } from '@/hooks/use-setup-status'

type Query = {
  data?: { completed: boolean }
  isLoading: boolean
  error?: Error
}

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  push: vi.fn(),
  query: { isLoading: true } as Query,
  options: undefined as { queryKey: unknown[]; enabled: boolean } | undefined,
  client: undefined as unknown,
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
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: typeof mocks.options) => {
    mocks.options = options
    return mocks.query
  },
  useQueryClient: () => mocks.client,
}))

function render(pathname: string, query: Query) {
  mocks.pathname = pathname
  mocks.query = query
  return renderToStaticMarkup(createElement(SetupChecker, null, 'Your files'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setup checker', () => {
  it('sends pages to setup while the instance has no account', () => {
    expect(
      render('/dashboard', { data: { completed: false }, isLoading: false })
    ).toBe('Your files')
    expect(mocks.push).toHaveBeenCalledWith('/setup')
  })

  it('never redirects away from setup', () => {
    for (const completed of [false, true])
      render('/setup', { data: { completed }, isLoading: false })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('keeps the page when the check fails, so it can show its own error', () => {
    const error = new Error('Setup check failed: 503')
    expect(render('/dashboard', { isLoading: false, error })).toBe('Your files')
    // A refetch that fails keeps the last answer and its error together.
    expect(
      render('/auth/login', {
        data: { completed: true },
        isLoading: false,
        error,
      })
    ).toBe('Your files')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shows nothing until the first answer arrives', () => {
    expect(render('/dashboard', { isLoading: true })).toBe('')
    expect(mocks.options?.enabled).toBe(true)
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe('setup completion signal', () => {
  it('records completion under the status the checker reads', () => {
    const client = new QueryClient()
    mocks.client = client
    render('/setup', { data: { completed: false }, isLoading: false })
    const key = mocks.options!.queryKey
    expect(client.getQueryData(key)).toBeUndefined()
    useMarkSetupComplete()()
    expect(client.getQueryData(key)).toEqual({ completed: true })
  })
})
