import { DELETE as revokeLegacyToken } from '@/app/api/profile/upload-tools/legacy-token/route'
import { GET as uploadTools } from '@/app/api/profile/upload-tools/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PROTOCOL_VERSION } from '@/lib/e2ee/contexts'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import { requestUploadOptions } from '@/lib/uploads/options'
import {
  UPLOADER_CLIENT_IDS,
  type UploaderClientId,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'
import {
  type UploaderConfiguration,
  flareUploadConfig,
  flareUploadConfigName,
  folderPublicKeyForConfiguration,
  renderUploaderFile,
  shareXAction,
  transportFor,
  uploaderAvailable,
} from '@/lib/uploads/uploader-clients/render'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  userUpdateMany: vi.fn(),
  tokenCount: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.user, updateMany: mocks.userUpdateMany },
    apiToken: { count: mocks.tokenCount },
  },
}))
vi.mock('@/lib/logger', () => ({
  loggers: { users: { error: vi.fn() }, api: { error: vi.fn() } },
}))

const TOKEN = 'flr_configuration-token'
const accountPublicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const plain: UploaderConfiguration = {
  origin: 'https://flare.test',
  token: TOKEN,
  profile: { id: 'screens', name: 'Chat screenshots' },
  encryption: 'plain',
  accountPublicKey: null,
  folder: null,
}
const encrypted: UploaderConfiguration = {
  ...plain,
  profile: { id: 'private', name: 'Private work' },
  encryption: 'encrypted',
  accountPublicKey,
}
const render = (
  id: UploaderClientId,
  configuration: UploaderConfiguration
): string =>
  renderUploaderFile(id, configuration, uploaderClients[id].defaults as never)

/** The upload request a generated plain file makes. */
function uploadRequest(id: UploaderClientId, body: string) {
  const [url, authorization] =
    id === 'sharex'
      ? [JSON.parse(body).RequestURL, JSON.parse(body).Headers.Authorization]
      : id === 'itake'
        ? [
            JSON.parse(body).request.url,
            JSON.parse(body).request.headers.Authorization,
          ]
        : [
            /^API_URL="([^"]+)"$/m.exec(body)![1],
            `Bearer ${/^UPLOAD_TOKEN="([^"]+)"$/m.exec(body)![1]}`,
          ]
  return new Request(url, { method: 'POST', headers: { authorization } })
}

describe('files for a plain profile', () => {
  it.each(UPLOADER_CLIENT_IDS)(
    '%s is offered and carries the new token and the profile',
    (id) => {
      expect(uploaderAvailable(id, 'plain')).toBe(true)
      const request = uploadRequest(id, render(id, plain))
      expect(new URL(request.url).pathname).toBe('/api/files')
      expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
      expect(requestUploadOptions(request)).toEqual({ profileId: 'screens' })
    }
  )

  it('follows the default profile when the configuration names none, and keeps a folder', () => {
    const request = uploadRequest(
      'sharex',
      render('sharex', { ...plain, profile: null })
    )
    expect(request.url).toBe('https://flare.test/api/files')
    const filed = uploadRequest(
      'itake',
      render('itake', {
        ...plain,
        folder: { id: 'folder-1', publicKey: null, visibility: 'PUBLIC' },
      })
    )
    expect(requestUploadOptions(filed)).toEqual({
      profileId: 'screens',
      folderId: 'folder-1',
    })
  })

  it('reads the share link from the same response field in each declarative format', () => {
    const sharex = JSON.parse(render('sharex', plain))
    expect(sharex.URL).toBe('{json:data.pageUrl}')
    expect(sharex.Body).toBe('MultipartFormData')
    const itake = JSON.parse(render('itake', plain))
    expect(itake.response.linkPath).toBe('data.pageUrl')
    expect(itake.name).toBe('Flare — Chat screenshots')
  })
})

describe('files for an encrypted profile', () => {
  it('offers only tools that can start a program, because a request description cannot encrypt', () => {
    expect(transportFor('encrypted')).toBe('helper')
    expect(transportFor('plain')).toBe('request')
    expect(
      UPLOADER_CLIENT_IDS.filter((id) => uploaderAvailable(id, 'encrypted'))
    ).toEqual(['sharex', 'flameshot', 'spectacle', 'bash'])
    // ShareX starts the program through an action, not through a .sxcu file.
    for (const id of ['sharex', 'itake'] as const)
      expect(() => render(id, encrypted)).toThrow('cannot encrypt')
  })

  it.each(['flameshot', 'spectacle', 'bash'] as const)(
    'the %s script starts flare-upload and holds no token',
    (id) => {
      const script = render(id, encrypted)
      expect(script).toContain('flare-upload --config "$FLARE_UPLOAD_CONFIG"')
      expect(script).toContain('/flare-upload/private-work.json}"')
      expect(script).not.toContain(TOKEN)
      expect(script).not.toContain('curl')
      expect(script).not.toContain('Authorization')
    }
  )

  it('writes the flare-upload configuration with the pinned account key and no private value', () => {
    const text = flareUploadConfig(encrypted)
    const config = JSON.parse(text)
    expect(config).toEqual({
      format: 'flare-upload-config',
      version: 1,
      origin: 'https://flare.test',
      token: TOKEN,
      protocol_version: PROTOCOL_VERSION,
      account_public_key: expect.any(String),
      profile_id: 'private',
      encryption: 'encrypted',
    })
    expect([...base64urlDecode(config.account_public_key)]).toEqual([
      ...accountPublicKey,
    ])
    expect(text).not.toMatch(/private_key|secret|passphrase|file_key/i)
    expect(flareUploadConfigName(encrypted)).toBe('private-work.json')
    expect(flareUploadConfigName({ profile: null })).toBe('config.json')
    expect(
      flareUploadConfigName({ profile: { id: 'x', name: '../../etc/passwd' } })
    ).toBe('etc-passwd.json')
  })

  it('refuses an encrypted configuration without the account key of the unlocked browser', () => {
    expect(() =>
      flareUploadConfig({ ...encrypted, accountPublicKey: null })
    ).toThrow('needs the account public key')
  })

  it('a plain configuration holds no key and no protocol version', () => {
    expect(JSON.parse(flareUploadConfig(plain))).toEqual({
      format: 'flare-upload-config',
      version: 1,
      origin: 'https://flare.test',
      token: TOKEN,
      profile_id: 'screens',
      encryption: 'plain',
    })
  })

  it('names the folder, and pins its key and the visibility once folders have keys', () => {
    const folder = { id: 'folder-1', visibility: 'PUBLIC' as const }
    // PHASE 4 INTEGRATION: folders have no key pair on this branch.
    expect(folderPublicKeyForConfiguration(folder)).toBeNull()
    const unpinned = JSON.parse(
      flareUploadConfig({
        ...encrypted,
        folder: { ...folder, publicKey: null },
      })
    )
    expect(unpinned.folder_id).toBe('folder-1')
    expect(unpinned).not.toHaveProperty('folder_public_key')
    expect(unpinned).not.toHaveProperty('visibility')
    const folderPublicKey = Uint8Array.from({ length: 32 }, () => 9)
    const pinned = JSON.parse(
      flareUploadConfig({
        ...encrypted,
        folder: { ...folder, publicKey: folderPublicKey },
      })
    )
    expect([...base64urlDecode(pinned.folder_public_key)]).toEqual([
      ...folderPublicKey,
    ])
    expect(pinned.visibility).toBe('PUBLIC')
  })

  it('gives ShareX an action that passes the captured file and copies the link', () => {
    expect(shareXAction(encrypted)).toEqual({
      name: 'Flare (Private work)',
      arguments: '--use private-work --copy "$input"',
      configPath: '%APPDATA%\\flare-upload\\private-work.json',
    })
    expect(shareXAction({ profile: null })).toEqual({
      name: 'Flare',
      arguments: '--copy "$input"',
      configPath: '%APPDATA%\\flare-upload\\config.json',
    })
  })
})

describe('the upload tools routes', () => {
  const account = { id: 'owner', permissions: [...DEFAULT_PERMISSIONS] }
  const site = 'https://flare.test'
  const get = (headers: Record<string, string> = {}) =>
    uploadTools(new Request(`${site}/api/profile/upload-tools`, { headers }))
  const revoke = (headers: Record<string, string> = {}) =>
    revokeLegacyToken(
      new Request(`${site}/api/profile/upload-tools/legacy-token`, {
        method: 'DELETE',
        headers: { Origin: site, ...headers },
      })
    )

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXTAUTH_URL', `${site}/`)
    mocks.session.mockResolvedValue({ user: account })
    mocks.user.mockResolvedValue({
      uploadTokenHash: 'a'.repeat(64),
      uploadTokenUsedAt: new Date('2026-11-09T10:00:00Z'),
    })
    mocks.userUpdateMany.mockResolvedValue({ count: 1 })
    mocks.tokenCount.mockResolvedValue(0)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers the public address and the state of the old token, and never a token or a hash', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = await response.json()
    expect(body).toEqual({
      origin: site,
      legacyToken: {
        active: true,
        lastUsedAt: '2026-11-09T10:00:00.000Z',
        hasNewConfiguration: false,
      },
    })
    expect(JSON.stringify(body)).not.toContain('a'.repeat(64))
    expect(mocks.user).toHaveBeenCalledWith({
      where: { id: 'owner' },
      select: { uploadTokenHash: true, uploadTokenUsedAt: true },
    })
  })

  it('counts only usable upload tokens from after the upgrade as a new configuration', async () => {
    mocks.tokenCount.mockResolvedValue(2)
    expect((await (await get()).json()).legacyToken.hasNewConfiguration).toBe(
      true
    )
    expect(mocks.tokenCount.mock.calls[0][0].where).toMatchObject({
      userId: 'owner',
      predatesEncryption: false,
      revokedAt: null,
      scopes: { has: 'files:upload' },
    })
  })

  it('reports a revoked old token as inactive, without a last use', async () => {
    mocks.user.mockResolvedValue({
      uploadTokenHash: null,
      uploadTokenUsedAt: new Date(),
    })
    expect((await (await get()).json()).legacyToken).toEqual({
      active: false,
      lastUsedAt: null,
      hasNewConfiguration: false,
    })
  })

  it.each([
    ['https://example.com/', 'https://example.com'],
    ['https://example.com/base/', 'https://example.com/base'],
  ])('keeps the path of the public URL %s', async (configured, origin) => {
    vi.stubEnv('NEXTAUTH_URL', configured)
    expect((await (await get()).json()).origin).toBe(origin)
  })

  it('needs a browser session with tokens.manage, and refuses API credentials', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect((await revoke()).status).toBe(401)
    mocks.session.mockResolvedValue({
      user: { id: 'owner', permissions: ['files.upload'] },
    })
    expect((await get()).status).toBe(403)
    expect((await revoke()).status).toBe(403)
    mocks.session.mockResolvedValue({ user: account })
    expect((await get({ authorization: 'Bearer flr_named' })).status).toBe(401)
    expect((await revoke({ authorization: 'Bearer legacy' })).status).toBe(401)
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a server URL with a query, and a missing one in production', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com/?token=1')
    expect((await get()).status).toBe(500)
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect((await get()).status).toBe(500)
    vi.stubEnv('NODE_ENV', 'development')
    expect((await (await get()).json()).origin).toBe('http://localhost:3000')
  })

  it('revokes the old token of the signed-in account and issues no new one', async () => {
    mocks.user.mockResolvedValue({
      uploadTokenHash: null,
      uploadTokenUsedAt: null,
    })
    const response = await revoke()
    expect(response.status).toBe(200)
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'owner', uploadTokenHash: { not: null } },
      data: { uploadTokenHash: null, uploadTokenUsedAt: null },
    })
    expect(await response.json()).toEqual({
      legacyToken: {
        active: false,
        lastUsedAt: null,
        hasNewConfiguration: false,
      },
    })
  })

  it('refuses a revocation from a different site', async () => {
    const response = await revoke({
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(response.status).toBe(403)
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })
})
