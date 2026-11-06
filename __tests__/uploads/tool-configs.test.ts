import { GET as bash } from '@/app/api/profile/bash/route'
import { POST as flameshot } from '@/app/api/profile/flameshot/route'
import { GET as itake } from '@/app/api/profile/itake/route'
import { GET as sharex } from '@/app/api/profile/sharex/route'
import { POST as spectacle } from '@/app/api/profile/spectacle/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import {
  requestUploadOptions,
  resolveUploadOptions,
} from '@/lib/uploads/options'
import {
  UPLOADER_CLIENT_IDS,
  type UploaderClientId,
  uploaderClientRequest,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  profile: vi.fn(),
  findApiToken: vi.fn(),
  createApiToken: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.user },
    role: {
      findUnique: vi.fn(async () => ({
        id: 'everyone',
        name: 'Everyone',
        position: 0,
        systemKey: 'everyone',
        permissions: [...DEFAULT_PERMISSIONS],
      })),
    },
    uploadProfile: { findFirst: mocks.profile },
    apiToken: {
      findUnique: mocks.findApiToken,
      create: mocks.createApiToken,
    },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'delivery' } } },
    },
  }),
}))
vi.mock('@/lib/email/config', () => ({ getEmailConfig: async () => ({}) }))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: () => false,
}))
vi.mock('@/lib/logger', () => ({
  loggers: { users: { error: vi.fn() }, files: { error: vi.fn() } },
}))

const owner = {
  id: 'owner',
  name: 'Screenshot User',
  uploadToken: 'existing-account-upload-token',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  defaultUploadProfileId: 'default-profile',
  defaultFileExpiration: 'DISABLED',
  defaultFileExpirationAction: 'DELETE',
}
const handlers: Record<
  UploaderClientId,
  (request: Request) => Promise<Response>
> = { sharex, itake, bash, flameshot, spectacle }
const clients = UPLOADER_CLIENT_IDS.map((id) => ({
  id,
  name: uploaderClients[id].label,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://flare.test/')
  mocks.session.mockResolvedValue({
    user: { id: owner.id, permissions: [...DEFAULT_PERMISSIONS] },
  })
  mocks.user.mockResolvedValue(owner)
  mocks.profile.mockImplementation(async ({ where }) =>
    where.userId === owner.id &&
    ['default-profile', 'screenshots'].includes(where.id)
      ? {
          id: where.id,
          name: where.id === 'screenshots' ? 'Screenshots' : 'Default profile',
          options: { visibility: 'PRIVATE' },
          updatedAt: new Date('2026-09-13T12:00:00Z'),
        }
      : null
  )
})
afterEach(() => vi.unstubAllEnvs())

/**
 * Each download's type, and its file name after the account-name prefix,
 * with default options.
 */
const downloads: Record<UploaderClientId, { type: string; name: string }> = {
  sharex: { type: 'application/json', name: 'sharex.sxcu' },
  itake: { type: 'application/json', name: 'itake.itup' },
  flameshot: { type: 'text/plain', name: 'flameshot.sh' },
  spectacle: { type: 'text/plain', name: 'spectacle-screenshot.sh' },
  bash: { type: 'text/plain', name: 'upload.sh' },
}

/** Downloads a client the way the dashboard asks for it. */
function download<Id extends UploaderClientId>(
  id: Id,
  profileId?: string,
  authorization?: string
) {
  const [path, init] = uploaderClientRequest(
    id,
    uploaderClients[id].defaults,
    profileId
  )
  const request = new Request(new URL(path, 'https://flare.test'), init)
  if (authorization) request.headers.set('Authorization', authorization)
  return handlers[id](request)
}

/** The upload request an installed client makes with the downloaded file. */
async function uploadRequest(
  id: UploaderClientId,
  response: Response,
  profileName = 'Account defaults'
) {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe(downloads[id].type)
  expect(response.headers.get('content-disposition')).toBe(
    `attachment; filename="screenshot-user-${downloads[id].name}"`
  )
  // Every download carries the account upload token.
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  if (id === 'sharex') {
    const config = await response.json()
    expect(config).toMatchObject({
      RequestMethod: 'POST',
      Body: 'MultipartFormData',
      FileFormName: 'file',
      URL: '{json:data.pageUrl}',
    })
    return new Request(config.RequestURL, {
      method: config.RequestMethod,
      headers: config.Headers,
    })
  }
  if (id === 'itake') {
    const config = await response.json()
    expect(config).toMatchObject({
      name: `Flare — ${profileName}`,
      request: { method: 'POST' },
      body: { type: 'multipart', fileField: 'file', fields: {} },
      response: { linkPath: 'data.pageUrl' },
    })
    return new Request(config.request.url, {
      method: config.request.method,
      headers: config.request.headers,
    })
  }
  const script = await response.text()
  expect(script).toContain('-H "Authorization: Bearer $UPLOAD_TOKEN"')
  expect(script).toContain('-F "file=@')
  expect(script).toContain(`jq -r '.data.pageUrl // empty'`)
  expect(script).not.toContain('copyText')
  const url = /^API_URL="([^"]+)"$/m.exec(script)?.[1]
  const token = /^UPLOAD_TOKEN="([^"]+)"$/m.exec(script)?.[1]
  expect(url).toBeDefined()
  expect(token).toBeDefined()
  return new Request(url!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe.each(clients)('$name setup download', ({ id }) => {
  it('is ready to authenticate and follow account defaults without creating an API token', async () => {
    const request = await uploadRequest(id, await download(id))
    expect(request.url).toBe('https://flare.test/api/files')
    expect(request.headers.get('authorization')).toBe(
      `Bearer ${owner.uploadToken}`
    )
    expect(mocks.profile).not.toHaveBeenCalled()

    // External tools authenticate without a browser session after installation.
    mocks.session.mockResolvedValue(null)
    const user = await getAuthenticatedUser(request)
    expect(user?.id).toBe(owner.id)
    expect(mocks.user).toHaveBeenCalledWith(
      expect.objectContaining({ where: { uploadToken: owner.uploadToken } })
    )
    await expect(
      resolveUploadOptions(user!, requestUploadOptions(request))
    ).resolves.toMatchObject({
      profileId: 'default-profile',
      visibility: 'PRIVATE',
    })
    expect(mocks.findApiToken).not.toHaveBeenCalled()
    expect(mocks.createApiToken).not.toHaveBeenCalled()
  })

  it('keeps an explicitly selected profile in the generated upload request', async () => {
    const request = await uploadRequest(
      id,
      await download(id, 'screenshots'),
      'Screenshots'
    )
    expect(requestUploadOptions(request)).toEqual({ profileId: 'screenshots' })
    expect(mocks.profile).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'screenshots', userId: owner.id },
      })
    )
    expect(mocks.profile).toHaveBeenCalledTimes(1)
  })

  it('preserves an encoded profile ID as a single query parameter', async () => {
    const profileId = 'screenshots & recordings/#1'
    mocks.profile.mockResolvedValue({
      id: profileId,
      name: 'Screenshots & recordings',
    })
    const request = await uploadRequest(
      id,
      await download(id, profileId),
      'Screenshots & recordings'
    )
    const uploadUrl = new URL(request.url)
    expect([...uploadUrl.searchParams.entries()]).toEqual([
      ['profileId', profileId],
    ])
    expect(uploadUrl.hash).toBe('')
  })

  it('rejects missing or other-account profiles without returning credentials', async () => {
    const response = await download(id, 'another-owner-profile')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Upload profile not found.',
    })
    expect(mocks.profile).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'another-owner-profile', userId: owner.id },
      })
    )
  })

  it.each([undefined, `Bearer ${owner.uploadToken}`, 'Bearer flr_named-token'])(
    'requires a signed-in browser session even when authorization is %s',
    async (authorization) => {
      mocks.session.mockResolvedValue(null)
      const response = await download(id, undefined, authorization)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Authentication required',
      })
      expect(mocks.user).not.toHaveBeenCalled()
      expect(mocks.profile).not.toHaveBeenCalled()
    }
  )

  it('requires tokens.manage', async () => {
    mocks.session.mockResolvedValue({
      user: { id: owner.id, permissions: ['files.upload'] },
    })
    const response = await download(id)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Permission denied' })
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it.each([
    ['https://flare.test///', 'https://flare.test/api/files'],
    ['https://flare.test/flare/', 'https://flare.test/flare/api/files'],
    ['http://localhost:3210/', 'http://localhost:3210/api/files'],
  ])(
    'uses the configured server URL %s in development',
    async (baseUrl, expected) => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('NEXTAUTH_URL', baseUrl)
      const request = await uploadRequest(id, await download(id))
      expect(request.url).toBe(expected)
    }
  )

  it('falls back to localhost only in development when no server URL is configured', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXTAUTH_URL', '')
    const request = await uploadRequest(id, await download(id))
    expect(request.url).toBe('http://localhost:3000/api/files')
  })

  it('rejects a missing production URL without returning credentials', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', '')
    const response = await download(id)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Invalid server URL configuration',
    })
  })

  it.each(
    ['development', 'production'].flatMap((environment) =>
      [
        'not-a-url',
        'ftp://flare.test',
        'file:///tmp/flare',
        'https://username:password@flare.test',
        'https://flare.test?unexpected=query',
        'https://flare.test#fragment',
      ].map((baseUrl) => [environment, baseUrl])
    )
  )(
    'rejects an invalid upload server URL in %s (%s) without returning credentials',
    async (environment, baseUrl) => {
      vi.stubEnv('NODE_ENV', environment)
      vi.stubEnv('NEXTAUTH_URL', baseUrl)
      const response = await download(id)
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Invalid server URL configuration',
      })
    }
  )

  it('returns 404 when the signed-in user no longer exists', async () => {
    mocks.user.mockResolvedValue(null)
    const response = await download(id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'User not found' })
  })

  it('keeps filenames safe when the account name contains header characters', async () => {
    mocks.user.mockResolvedValue({ ...owner, name: 'Jane "Mac"\r\nUser' })
    const response = await download(id)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="jane--mac---user-${downloads[id].name}"`
    )
  })
})

describe('script options', () => {
  function post(id: 'flameshot' | 'spectacle', body: string, query = '') {
    return handlers[id](
      new Request(`https://flare.test/api/profile/${id}${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    )
  }

  it('answers malformed JSON and invalid options with 400', async () => {
    const malformed = await post('flameshot', '{')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON.' })

    const invalid = await post('flameshot', JSON.stringify({ useWayland: 1 }))
    expect(invalid.status).toBe(400)
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it('keeps accepting a Spectacle screenshot delay, which the form no longer sends', async () => {
    const options = uploaderClients.spectacle.defaults
    expect(options).not.toHaveProperty('delay')
    const plain = await post('spectacle', JSON.stringify(options))
    expect(plain.status).toBe(200)
    expect(await plain.text()).not.toContain('-d ')

    const delayed = await post(
      'spectacle',
      JSON.stringify({ ...options, delay: 2500 })
    )
    expect(delayed.status).toBe(200)
    expect(await delayed.text()).toContain(
      'SPECTACLE_ARGS="$SPECTACLE_ARGS -d 2500"'
    )

    const tooLong = await post(
      'spectacle',
      JSON.stringify({ ...options, delay: 10001 })
    )
    expect(tooLong.status).toBe(400)
  })

  it('still honors a profile sent in the POST body', async () => {
    const response = await post(
      'flameshot',
      JSON.stringify({
        ...uploaderClients.flameshot.defaults,
        profileId: 'screenshots',
      })
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(
      'API_URL="https://flare.test/api/files?profileId=screenshots"'
    )
  })
})
