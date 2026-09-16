import { GET as bash } from '@/app/api/profile/bash/route'
import { POST as flameshot } from '@/app/api/profile/flameshot/route'
import { GET as sharex } from '@/app/api/profile/sharex/route'
import { POST as spectacle } from '@/app/api/profile/spectacle/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import {
  requestUploadOptions,
  resolveUploadOptions,
} from '@/lib/uploads/options'

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
  role: 'USER',
  randomizeFileUrls: false,
  defaultUploadProfileId: 'default-profile',
  defaultFileExpiration: 'DISABLED',
  defaultFileExpirationAction: 'DELETE',
}
const clients = [
  { name: 'ShareX', path: 'sharex', handler: sharex, options: null },
  { name: 'Bash', path: 'bash', handler: bash, options: null },
  {
    name: 'Flameshot',
    path: 'flameshot',
    handler: flameshot,
    options: { useWayland: false, useCompositor: false },
  },
  {
    name: 'Spectacle',
    path: 'spectacle',
    handler: spectacle,
    options: {
      scriptType: 'screenshot',
      useWayland: false,
      includePointer: false,
      captureMode: 'region',
      recordingMode: 'region',
      delay: 0,
    },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://flare.test/')
  mocks.session.mockResolvedValue({ user: { id: owner.id } })
  mocks.user.mockResolvedValue(owner)
  mocks.profile.mockImplementation(async ({ where }) =>
    where.userId === owner.id &&
    ['default-profile', 'screenshots'].includes(where.id)
      ? {
          id: where.id,
          options: { visibility: 'PRIVATE' },
          updatedAt: new Date('2026-09-13T12:00:00Z'),
        }
      : null
  )
})
afterEach(() => vi.unstubAllEnvs())

describe.each(clients)('$name setup download', (client) => {
  function download(profileId?: string, authorization?: string) {
    const url = new URL(`https://flare.test/api/profile/${client.path}`)
    if (profileId) url.searchParams.set('profileId', profileId)
    return client.handler(
      new Request(url, {
        method: client.options ? 'POST' : 'GET',
        headers: {
          ...(client.options && { 'Content-Type': 'application/json' }),
          ...(authorization && { Authorization: authorization }),
        },
        ...(client.options && { body: JSON.stringify(client.options) }),
      })
    )
  }

  async function uploadRequest(response: Response) {
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    if (client.path === 'sharex') {
      const config = await response.json()
      expect(config).toMatchObject({
        RequestMethod: 'POST',
        Body: 'MultipartFormData',
        FileFormName: 'file',
        URL: '{json:data.copyText}',
      })
      return new Request(config.RequestURL, {
        method: config.RequestMethod,
        headers: config.Headers,
      })
    }
    const script = await response.text()
    expect(script).toContain('-H "Authorization: Bearer $UPLOAD_TOKEN"')
    expect(script).toContain('-F "file=@')
    expect(script).toContain('.copyText // .data.copyText')
    const url = /^API_URL="([^"]+)"$/m.exec(script)?.[1]
    const token = /^UPLOAD_TOKEN="([^"]+)"$/m.exec(script)?.[1]
    expect(url).toBeDefined()
    expect(token).toBeDefined()
    return new Request(url!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  it('is ready to authenticate and follow account defaults without creating an API token', async () => {
    const request = await uploadRequest(await download())
    expect(request.url).toBe('https://flare.test/api/files')
    expect(request.headers.get('authorization')).toBe(
      `Bearer ${owner.uploadToken}`
    )
    expect(mocks.profile).not.toHaveBeenCalled()

    // External tools authenticate without a browser session after installation.
    mocks.session.mockResolvedValue(null)
    const user = await getAuthenticatedUser(request)
    expect(user?.id).toBe(owner.id)
    expect(mocks.user).toHaveBeenLastCalledWith(
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
    const request = await uploadRequest(await download('screenshots'))
    expect(requestUploadOptions(request)).toEqual({ profileId: 'screenshots' })
    expect(mocks.profile).toHaveBeenCalledWith({
      where: { id: 'screenshots', userId: owner.id },
    })
  })

  it('rejects missing or other-account profiles without returning credentials', async () => {
    const response = await download('another-owner-profile')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Upload profile not found.',
    })
    expect(mocks.profile).toHaveBeenCalledWith({
      where: { id: 'another-owner-profile', userId: owner.id },
    })
  })

  it.each([undefined, `Bearer ${owner.uploadToken}`, 'Bearer flr_named-token'])(
    'requires a signed-in browser session even when authorization is %s',
    async (authorization) => {
      mocks.session.mockResolvedValue(null)
      const response = await download(undefined, authorization)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
      expect(mocks.user).not.toHaveBeenCalled()
      expect(mocks.profile).not.toHaveBeenCalled()
    }
  )
})
