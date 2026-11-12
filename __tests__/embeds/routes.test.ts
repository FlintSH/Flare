import { GET as embed } from '@/app/(raw)/[userUrlId]/[filename]/embed/route'
import { GET as media } from '@/app/(raw)/[userUrlId]/[filename]/media/route'
import { GET as oembed } from '@/app/api/oembed/route'
import {
  GET as readEmbed,
  PATCH as saveEmbed,
} from '@/app/api/profile/embed/route'
import { hashSync } from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { DEFAULT_PERSONAL_EMBED } from '@/lib/embeds/schema'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findFile: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  publicUrl: vi.fn(),
  storageKind: 'local' as 'local' | 's3',
  sharing: {} as Record<string, unknown>,
  ownerPermissions: ['files.share'] as string[],
  audit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => {
  const user = {
    findUnique: mocks.findUser,
    findUniqueOrThrow: mocks.findUser,
    update: mocks.updateUser,
  }
  return {
    prisma: {
      file: { findUnique: mocks.findFile },
      user,
      $transaction: (run: (tx: unknown) => unknown) =>
        run({ user, $queryRaw: async () => [] }),
    },
  }
})
vi.mock('@/lib/permissions/server', () => ({
  getUserAccess: async () => ({
    roles: [],
    permissions: mocks.ownerPermissions,
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    kind: mocks.storageKind,
    getPublicUrl: mocks.publicUrl,
  }),
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          ...DEFAULT_APPEARANCE,
          sharing: { ...DEFAULT_APPEARANCE.sharing, ...mocks.sharing },
        },
      },
    },
  }),
}))

const DISCORD =
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const password = 'disposable-file-password'

const image = {
  id: 'embed-file',
  name: 'photo.png',
  urlPath: '/owner/photo.png',
  path: 'owner/key/photo.png',
  mimeType: 'image/png',
  size: 2,
  visibility: 'PUBLIC' as 'PUBLIC' | 'PRIVATE',
  password: null as string | null,
  userId: 'owner-id',
  views: 3,
  uploadedAt: new Date('2026-11-12T10:00:00Z'),
  user: { name: 'Mira', preferences: {} },
}
const video = {
  ...image,
  name: 'clip.mp4',
  urlPath: '/owner/clip.mp4',
  path: 'owner/key/clip.mp4',
  mimeType: 'video/mp4',
}

const params = (filename: string) => ({
  params: Promise.resolve({ userUrlId: 'owner', filename }),
})

function request(path: string, agent?: string) {
  return new Request(`https://flare.example${path}`, {
    headers: {
      host: 'flare.example',
      ...(agent ? { 'user-agent': agent } : {}),
    },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
  configureAuditWriter(mocks.audit)
  mocks.session.mockResolvedValue(null)
  mocks.findFile.mockResolvedValue(image)
  mocks.findUser.mockResolvedValue(null)
  mocks.publicUrl.mockResolvedValue(null)
  mocks.storageKind = 'local'
  mocks.sharing = {}
  mocks.ownerPermissions = ['files.share']
})

describe('what a link-preview fetcher is sent', () => {
  it('redirects an app that shows images on their own to the image', async () => {
    const response = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/owner/photo.png/raw')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('User-Agent')
  })

  it('sends other apps, and anyone opening it, the card as a small page', async () => {
    const response = await embed(
      request('/owner/photo.png/embed', 'Twitterbot/1.0'),
      params('photo.png')
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8'
    )
    const html = await response.text()
    expect(html).toContain('<title>photo.png (2.00 MB)</title>')
    expect(html).toContain(
      '<meta property="og:image" content="https://flare.example/owner/photo.png/raw">'
    )
    expect(html.length).toBeLessThan(2000)
  })

  it('sends the card for every file once the instance chooses rich embeds', async () => {
    mocks.sharing = { embedMode: 'rich', embedColor: '#5b8def' }
    const response = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(
      '<meta name="theme-color" content="#5b8def">'
    )
  })

  it("uses the owner's own embed only while their roles allow one", async () => {
    mocks.findFile.mockResolvedValue({
      ...image,
      user: {
        name: 'Mira',
        preferences: {
          embed: { mode: 'rich', design: 'custom', siteName: 'mira.example' },
        },
      },
    })
    const own = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(await own.text()).toContain(
      '<meta property="og:site_name" content="mira.example">'
    )
    mocks.ownerPermissions = ['files.read']
    const revoked = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(revoked.status).toBe(307)
  })

  it('sends the page with a policy that lets nothing in it load or run', async () => {
    const response = await embed(
      request('/owner/photo.png/embed', 'Twitterbot/1.0'),
      params('photo.png')
    )
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox"
    )
  })

  it('never puts a signed storage URL in a video preview', async () => {
    mocks.findFile.mockResolvedValue(video)
    mocks.storageKind = 's3'
    mocks.publicUrl.mockResolvedValue(
      'https://bucket.example/clip.mp4?X-Amz-Expires=21600'
    )
    const response = await embed(
      request('/owner/clip.mp4/embed', DISCORD),
      params('clip.mp4')
    )
    const html = await response.text()
    expect(html).toContain(
      '<meta property="og:video" content="https://flare.example/owner/clip.mp4/media">'
    )
    expect(html).not.toContain('X-Amz')
    expect(mocks.publicUrl).not.toHaveBeenCalled()
  })

  it('answers a missing or private file with nothing', async () => {
    mocks.findFile.mockResolvedValue({ ...image, visibility: 'PRIVATE' })
    const hidden = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(hidden.status).toBe(404)
    expect(await hidden.text()).toBe('')
    mocks.findFile.mockResolvedValue(null)
    const missing = await embed(
      request('/owner/nothing.png/embed', DISCORD),
      params('nothing.png')
    )
    expect(missing.status).toBe(404)
  })

  it('says a file behind a password is protected, and previews it with the password', async () => {
    mocks.findFile.mockResolvedValue({
      ...image,
      password: hashSync(password, 4),
    })
    const locked = await embed(
      request('/owner/photo.png/embed', DISCORD),
      params('photo.png')
    )
    expect(locked.status).toBe(200)
    const html = await locked.text()
    expect(html).toContain('<title>Protected file - Flare</title>')
    expect(html).not.toMatch(/photo\.png\/raw|Mira|2\.00 MB/)

    const query = new URLSearchParams({ password })
    const unlocked = await embed(
      request(`/owner/photo.png/embed?${query}`, DISCORD),
      params('photo.png')
    )
    expect(unlocked.status).toBe(307)
    expect(unlocked.headers.get('location')).toBe(
      `/owner/photo.png/raw?${query}`
    )
  })

  it('records the request against the file', async () => {
    await embed(request('/owner/photo.png/embed', DISCORD), params('photo.png'))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.embed',
        targetId: 'embed-file',
        route: '/[userUrlId]/[filename]/embed',
      })
    )
  })
})

describe('the media address', () => {
  it('signs a new storage URL for a video on every request', async () => {
    mocks.findFile.mockResolvedValue(video)
    mocks.publicUrl
      .mockResolvedValueOnce('https://bucket.example/clip.mp4?sig=1')
      .mockResolvedValueOnce('https://bucket.example/clip.mp4?sig=2')
    for (const signature of ['1', '2']) {
      const response = await media(
        request('/owner/clip.mp4/media'),
        params('clip.mp4')
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(
        `https://bucket.example/clip.mp4?sig=${signature}`
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(mocks.publicUrl).toHaveBeenCalledWith('owner/key/clip.mp4')
  })

  it("leads to the file's raw content when storage has no URL of its own", async () => {
    mocks.findFile.mockResolvedValue(video)
    const response = await media(
      request('/owner/clip.mp4/media'),
      params('clip.mp4')
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/owner/clip.mp4/raw')
  })

  it('never hands out a storage URL for other kinds of file', async () => {
    mocks.publicUrl.mockResolvedValue('https://bucket.example/photo.png?sig=1')
    const response = await media(
      request('/owner/photo.png/media'),
      params('photo.png')
    )
    expect(response.headers.get('location')).toBe('/owner/photo.png/raw')
    expect(mocks.publicUrl).not.toHaveBeenCalled()
  })

  it('checks access before answering, and keeps the password in the address', async () => {
    mocks.publicUrl.mockResolvedValue('https://bucket.example/clip.mp4?sig=1')
    mocks.findFile.mockResolvedValue({ ...video, visibility: 'PRIVATE' })
    const hidden = await media(
      request('/owner/clip.mp4/media'),
      params('clip.mp4')
    )
    expect(hidden.status).toBe(404)
    expect(hidden.headers.get('location')).toBeNull()

    mocks.findFile.mockResolvedValue({
      ...video,
      password: hashSync(password, 4),
    })
    const locked = await media(
      request('/owner/clip.mp4/media'),
      params('clip.mp4')
    )
    expect(locked.status).toBe(401)
    expect(locked.headers.get('location')).toBeNull()
    // No cache may keep a refusal where the redirect belongs.
    expect(locked.headers.get('cache-control')).toBe('private, no-store')

    mocks.publicUrl.mockResolvedValue(null)
    const query = new URLSearchParams({ password })
    const unlocked = await media(
      request(`/owner/clip.mp4/media?${query}`),
      params('clip.mp4')
    )
    expect(unlocked.headers.get('location')).toBe(
      `/owner/clip.mp4/raw?${query}`
    )
  })
})

describe('oEmbed', () => {
  const lookup = (url: string, format = 'json') =>
    oembed(request(`/api/oembed?${new URLSearchParams({ url, format })}`))

  it("describes a public file with the card's own lines", async () => {
    mocks.sharing = { authorTemplate: '{{uploader}}' }
    const response = await lookup('https://flare.example/owner/photo.png')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: '1.0',
      type: 'link',
      title: 'photo.png (2.00 MB)',
      author_name: 'Mira',
      provider_name: 'Flare',
      provider_url: 'https://flare.example',
    })
    expect(mocks.findFile).toHaveBeenCalledWith(
      expect.objectContaining({ where: { urlPath: '/owner/photo.png' } })
    )
  })

  it('answers only for files anyone may open', async () => {
    for (const hidden of [
      { ...image, visibility: 'PRIVATE' as const },
      { ...image, password: hashSync(password, 4) },
      null,
    ]) {
      mocks.findFile.mockResolvedValue(hidden)
      const response = await lookup('https://flare.example/owner/photo.png')
      expect(response.status).toBe(404)
      expect(JSON.stringify(await response.json())).not.toMatch(/photo|Mira/)
    }
  })

  it('refuses addresses that are not share links, and other formats', async () => {
    for (const url of [
      '',
      'not a url at all %',
      'https://flare.example/',
      'https://flare.example/owner',
      'https://flare.example/owner/photo.png/raw',
      'https://flare.example/owner/%E0%A4%A',
    ])
      expect((await lookup(url)).status, url).toBe(404)
    expect(
      (await lookup('https://flare.example/owner/photo.png', 'xml')).status
    ).toBe(501)
  })
})

describe('personal embed settings API', () => {
  const account = { id: 'owner-id', permissions: ['files.share'] }
  const save = (body: unknown, origin = 'https://flare.example') =>
    saveEmbed(
      new Request('https://flare.example/api/profile/embed', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      })
    )

  it('reads the saved choice and whether the instance allows one', async () => {
    mocks.session.mockResolvedValue({ user: account })
    mocks.findUser.mockResolvedValue({
      preferences: { embed: { mode: 'rich' } },
    })
    const response = await readEmbed(request('/api/profile/embed'))
    expect(await response.json()).toEqual({
      data: { ...DEFAULT_PERSONAL_EMBED, mode: 'rich' },
      allowed: true,
    })
  })

  it('saves beside the other preferences an account has', async () => {
    mocks.session.mockResolvedValue({ user: account })
    mocks.findUser.mockResolvedValue({
      preferences: { customization: { themeMode: 'dark' } },
    })
    const response = await save({ mode: 'rich', design: 'custom', title: 'Hi' })
    expect(response.status).toBe(200)
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: 'owner-id' },
      data: {
        preferences: {
          customization: { themeMode: 'dark' },
          embed: {
            ...DEFAULT_PERSONAL_EMBED,
            mode: 'rich',
            design: 'custom',
            title: 'Hi',
          },
        },
      },
    })
  })

  it('refuses a signed-out visitor, a role that cannot share, and other sites', async () => {
    expect((await save({ mode: 'rich' })).status).toBe(401)
    mocks.session.mockResolvedValue({
      user: { id: 'owner-id', permissions: ['files.read'] },
    })
    expect((await save({ mode: 'rich' })).status).toBe(403)
    mocks.session.mockResolvedValue({ user: account })
    expect(
      (await save({ mode: 'rich' }, 'https://elsewhere.example')).status
    ).toBe(403)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('refuses unknown placeholders and a choice the instance turned off', async () => {
    mocks.session.mockResolvedValue({ user: account })
    expect((await save({ title: '{{password}}' })).status).toBe(400)
    mocks.sharing = { personalEmbeds: false }
    const response = await save({ mode: 'rich' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This instance uses one embed for every account.',
    })
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
