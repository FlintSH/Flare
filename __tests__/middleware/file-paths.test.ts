import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'
import { beforeAll, describe, expect, it } from 'vitest'

import { isFileUrlPath } from '@/lib/middleware/constants'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'file-path-test-secret-0123456789abcdef'
})

function request(path: string, userAgent = 'Mozilla/5.0 Firefox/131.0') {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers: { 'user-agent': userAgent },
  })
}

// A signed-out request reaches Flare when the proxy passes it on rather
// than redirecting it to the sign-in page.
async function reachesFlare(path: string, userAgent?: string) {
  const response = await proxy(request(path, userAgent))
  return response.headers.get('x-middleware-next') === '1'
}

describe('public file paths', () => {
  it('accepts a share path and its routes when the URL name has no extension', () => {
    for (const path of [
      '/abc12/readme',
      '/abc12/readme/raw',
      '/abc12/readme/direct',
      '/abc12/readme/media',
      '/abc12/readme/embed',
      '/my-vanity/backup-verylongextension1',
      '/abc12/notes-2026-10-25-final/raw',
      // Dot-file names that earlier builds gave names like 日本語.png.
      '/abc12/.png',
    ])
      expect(isFileUrlPath(path), path).toBe(true)
  })

  it('keeps every path with an extension exactly as before', () => {
    for (const path of [
      '/abc12/report.pdf',
      '/abc12/report.pdf/raw',
      '/abc12/clip.mp4/direct',
      '/abc12/clip.mp4/media',
      '/abc12/report.pdf/embed',
      '/avatars/abc12.png',
    ])
      expect(isFileUrlPath(path), path).toBe(true)
  })

  it("never treats Flare's own routes as file paths", () => {
    for (const path of [
      '/dashboard/files',
      '/Dashboard/files',
      '/dashboard/raw',
      '/dashboard/files/raw',
      '/dashboard/files/embed',
      '/dashboard/media',
      '/auth/whatever',
      '/setup/email',
      '/api/files',
      '/admin/users',
      '/avatars/abc12',
      '/ab/readme',
      '/abc12',
      '/abc12/readme/other',
      '/abc12/readme/raw/extra',
      '/-abc/readme',
    ])
      expect(isFileUrlPath(path), path).toBe(false)
  })
})

describe('signed-out proxy handling', () => {
  it('lets signed-out visitors open public files without an extension', async () => {
    for (const path of [
      '/abc12/readme',
      '/abc12/readme/raw',
      '/abc12/readme/direct',
      '/abc12/readme/media',
      '/abc12/readme/embed',
      '/abc12/report.pdf',
    ])
      expect(await reachesFlare(path), path).toBe(true)
  })

  it('still sends signed-out visitors from app pages to sign in', async () => {
    for (const path of ['/dashboard/files', '/dashboard/settings']) {
      const response = await proxy(request(path))
      expect(response.status, path).toBe(307)
      expect(new URL(response.headers.get('location')!).pathname).toBe(
        '/auth/login'
      )
    }
  })
})

describe('link-preview fetchers', () => {
  const DISCORD = 'Mozilla/5.0 (compatible; Discordbot/2.0)'
  // Where the proxy sends a request without telling the client.
  async function rewrittenTo(path: string, userAgent: string) {
    const response = await proxy(request(path, userAgent))
    const target = response.headers.get('x-middleware-rewrite')
    return target && new URL(target).pathname + new URL(target).search
  }

  it("answers a share page request with the file's preview", async () => {
    expect(await rewrittenTo('/abc12/photo.png', DISCORD)).toBe(
      '/abc12/photo.png/embed'
    )
    expect(await rewrittenTo('/abc12/readme', 'Twitterbot/1.0')).toBe(
      '/abc12/readme/embed'
    )
    // A file can be called what one of its routes is called.
    for (const name of ['raw', 'direct', 'media', 'embed'])
      expect(await rewrittenTo(`/abc12/${name}`, DISCORD), name).toBe(
        `/abc12/${name}/embed`
      )
    // The preview checks a file password like the page does.
    expect(await rewrittenTo('/abc12/photo.png?password=p%26w', DISCORD)).toBe(
      '/abc12/photo.png/embed?password=p%26w'
    )
  })

  it("leaves a file's own routes as they are", async () => {
    for (const path of [
      '/abc12/photo.png/raw',
      '/abc12/clip.mp4/direct',
      '/abc12/clip.mp4/media',
      '/abc12/photo.png/embed',
    ]) {
      expect(await rewrittenTo(path, DISCORD), path).toBeNull()
      expect(await reachesFlare(path, DISCORD), path).toBe(true)
    }
  })

  it('gives browsers, in-app browsers and search engines the share page', async () => {
    for (const agent of [
      'Mozilla/5.0 Firefox/131.0',
      'Mozilla/5.0 (iPhone) Mobile/15E148 Twitter for iPhone/10.50',
      'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36 LinkedInApp',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ]) {
      expect(await rewrittenTo('/abc12/photo.png', agent), agent).toBeNull()
      expect(await reachesFlare('/abc12/photo.png', agent), agent).toBe(true)
    }
  })

  it('never previews an app page', async () => {
    const response = await proxy(request('/dashboard/files', DISCORD))
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.status).toBe(307)
  })

  it('lets a fetcher read the video poster without a session', async () => {
    expect(await reachesFlare('/video-poster.png', DISCORD)).toBe(true)
    expect(await reachesFlare('/video-poster.png')).toBe(true)
  })
})
