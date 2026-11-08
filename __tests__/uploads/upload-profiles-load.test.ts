import { Fragment, createElement } from 'react'

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
import {
  UploadActionSummary,
  UploadProfileSelect,
  useUploadSelection,
} from '@/components/upload-profiles/upload-selection'

import { RefusedRequest, TransportFailure } from '@/lib/client/request'
import { UPLOAD_DEFAULTS } from '@/lib/uploads/schema'

const session = vi.hoisted(() => ({
  permissions: ['uploadProfiles.manage'],
  userId: 'alice',
  browserId: 'alice-browser',
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: session.userId,
        sessionId: session.browserId,
        permissions: session.permissions,
      },
    },
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
let client: QueryClient
let seen: ReturnType<typeof useUploadProfiles>

function Probe({
  observe,
}: {
  observe: (value: ReturnType<typeof useUploadProfiles>) => void
}) {
  const value = useUploadProfiles()
  observe(value)
  return null
}

function render() {
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(Probe, {
        observe: (value) => {
          seen = value
        },
      })
    )
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
  session.userId = 'alice'
  session.browserId = 'alice-browser'
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

  it('keeps its refusal message and shows friendly transport recovery with the cause retained', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Permission denied' }, { status: 403 })
    )
    expect((await load()).error).toBe('Could not load upload profiles.')
    const refused = client.getQueryCache().getAll()[0].state.error
    expect(refused).toBeInstanceOf(RefusedRequest)
    expect(refused).toMatchObject({ message: 'Permission denied', status: 403 })

    client.clear()
    const cause = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(cause)
    expect((await load()).error).toBe(
      'Connection problem. Check the result before trying again.'
    )
    const failure = client.getQueryCache().getAll()[0].state.error
    expect(failure).toBeInstanceOf(TransportFailure)
    expect(failure?.cause).toBe(cause)
    // A failed read is not asked again on its own.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

let selected: ReturnType<typeof useUploadSelection>
function SelectionProbe({
  observe,
}: {
  observe: (value: ReturnType<typeof useUploadSelection>) => void
}) {
  const selection = useUploadSelection({ onChange: () => {} })
  observe(selection)
  return createElement(
    Fragment,
    null,
    createElement(UploadProfileSelect, {
      selection,
      onChange: () => {},
    }),
    createElement(UploadActionSummary, {
      id: 'action-summary',
      selection,
    })
  )
}
function renderSelection() {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SelectionProbe, {
        observe: (value) => {
          selected = value
        },
      })
    )
  )
}
async function loadSelection() {
  renderSelection()
  const query = client
    .getQueryCache()
    .getAll()
    .find(
      (entry) =>
        entry.queryKey[0] === 'upload-profiles' &&
        entry.queryKey[1] === session.userId &&
        entry.queryKey[2] === session.browserId
    )!
  const observer = new QueryObserver(client, {
    ...query.options,
    queryKey: query.queryKey,
  })
  const unsubscribe = observer.subscribe(() => {})
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
  )
  const html = renderSelection()
  unsubscribe()
  return html
}
const answer = (expiration: 'DAY' | 'WEEK') => ({
  profiles: [],
  defaultProfileId: null,
  accountOptions: {},
  effective: { ...UPLOAD_DEFAULTS, expiration },
  canShare: true,
})

describe('shared ordinary picker and final-action description', () => {
  it('uses one account query and one announcement for both pure views', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: answer('DAY') }))
    const html = await loadSelection()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'upload-profiles')
    ).toHaveLength(1)
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(html).toContain('1 day, then permanently delete')
    expect(selected.status).toBe('ready')
  })

  it('does not show another account or browser session’s effective settings', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: answer('DAY') }))
    await loadSelection()
    expect(selected.summary).toContain('1 day')
    session.userId = 'bob'
    session.browserId = 'bob-browser'
    const loading = renderSelection()
    expect(selected.status).toBe('loading')
    expect(loading).not.toContain('1 day')
    fetchMock.mockResolvedValueOnce(Response.json({ data: answer('WEEK') }))
    await loadSelection()
    expect(selected.summary).toContain('1 week')
    session.browserId = 'bob-second-browser'
    renderSelection()
    expect(selected.status).toBe('loading')
    expect(selected.summary).not.toContain('1 week')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not query or invent a full summary for a limited role', () => {
    session.permissions = ['files.upload']
    const html = renderSelection()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(html).not.toContain('combobox')
    expect(html).toContain('full settings are unavailable for this role')
    expect(html).not.toContain('no expiry')
  })
})
