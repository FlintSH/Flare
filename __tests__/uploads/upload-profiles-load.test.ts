import { createElement } from 'react'

import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ProfilePicker,
  useUploadProfiles,
} from '@/components/upload-profiles/profile-picker'

const session = vi.hoisted(() => ({ permissions: ['uploadProfiles.manage'] }))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: 'alice',
        sessionId: 'alice-browser',
        permissions: session.permissions,
      },
    },
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
let client: QueryClient
let seen: ReturnType<typeof useUploadProfiles>

function Probe() {
  seen = useUploadProfiles()
  return null
}

function render() {
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Probe))
  )
  return seen
}

/** Reads the profiles as a mounted picker would, then renders it again. */
async function load() {
  render()
  const query = client
    .getQueryCache()
    .getAll()
    .find((entry) => entry.queryKey[0] === 'upload-profiles')!
  const observer = new QueryObserver(client, {
    ...query.options,
    queryKey: query.queryKey,
  })
  const unsubscribe = observer.subscribe(() => {})
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
  )
  const result = render()
  unsubscribe()
  return result
}

beforeEach(() => {
  session.permissions = ['uploadProfiles.manage']
  // Each render here mounts the picker anew, which would ask again after a
  // failure; a picker that stays mounted keeps showing the error instead.
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

describe('loading upload profiles', () => {
  it('does not request or advertise profiles without their permission', async () => {
    session.permissions = ['files.read', 'files.upload', 'profile.update']
    expect(await load()).toEqual({ data: null, error: '' })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProfilePicker, { onChange: vi.fn() })
      )
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(html).not.toContain('Upload profile')
    expect(html).not.toContain('combobox')
    expect(html).not.toContain('Could not load')
    expect(html).toContain('Your uploads are private')
    expect(html).toContain('Your saved upload defaults apply automatically.')
  })

  it('keeps the explicit private archive fallback without profile access', () => {
    session.permissions = ['files.read', 'files.upload']
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProfilePicker, {
          mode: 'archive',
          value: null,
          onChange: vi.fn(),
        })
      )
    )
    expect(html).toContain('Private · no expiry · original filenames.')
    expect(html).toContain('No upload profile or account defaults are applied.')
    expect(html).not.toContain('combobox')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops a cached permission refusal when profile access is removed', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Permission denied' }, { status: 403 })
    )
    expect((await load()).error).toBe('Could not load upload profiles.')
    session.permissions = ['files.upload']
    expect(render()).toEqual({ data: null, error: '' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still reads profiles for an administrator', async () => {
    session.permissions = ['administrator']
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { profiles: [], defaultProfileId: null } })
    )
    expect((await load()).error).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the profiles from the answer', async () => {
    const profiles = {
      profiles: [],
      defaultProfileId: null,
      accountOptions: {},
      effective: {},
      canShare: true,
    }
    fetchMock.mockResolvedValueOnce(Response.json({ data: profiles }))
    expect(await load()).toEqual({ data: profiles, error: '' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload-profiles',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('keeps its own message for a refusal and passes network failures through', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Permission denied' }, { status: 403 })
    )
    expect((await load()).error).toBe('Could not load upload profiles.')

    client.clear()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await load()).error).toBe('Failed to fetch')
    // A failed read is not asked again on its own.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
