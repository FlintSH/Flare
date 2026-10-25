import { NextRequest } from 'next/server'

import { middleware } from '@/middleware'
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

// A signed-out request reaches Flare when the middleware passes it on rather
// than redirecting it to the sign-in page.
async function reachesFlare(path: string, userAgent?: string) {
  const response = await middleware(request(path, userAgent))
  return response.headers.get('x-middleware-next') === '1'
}

describe('public file paths', () => {
  it('accepts share, raw, and direct paths whose URL name has no extension', () => {
    for (const path of [
      '/abc12/readme',
      '/abc12/readme/raw',
      '/abc12/readme/direct',
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

describe('signed-out middleware handling', () => {
  it('lets signed-out visitors open public files without an extension', async () => {
    for (const path of [
      '/abc12/readme',
      '/abc12/readme/raw',
      '/abc12/readme/direct',
      '/abc12/report.pdf',
    ])
      expect(await reachesFlare(path), path).toBe(true)
  })

  it('still sends signed-out visitors from app pages to sign in', async () => {
    for (const path of ['/dashboard/files', '/dashboard/settings']) {
      const response = await middleware(request(path))
      expect(response.status, path).toBe(307)
      expect(new URL(response.headers.get('location')!).pathname).toBe(
        '/auth/login'
      )
    }
  })

  it('sends link-preview bots to the raw content of a file without an extension', async () => {
    const response = await middleware(
      request('/abc12/readme', 'Mozilla/5.0 (compatible; Discordbot/2.0)')
    )
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).pathname).toBe(
      '/abc12/readme/raw'
    )
  })
})
