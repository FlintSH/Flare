import { POST as uploadRoute } from '@/app/api/profile/avatar/route'
import { UpdateProfileSchema } from '@/types/dto/profile'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
  avatarProblem,
} from '@/lib/storage/avatar-policy'

const avatars = vi.hoisted(() => ({
  uploadAvatar: vi.fn(async () => '/api/avatars/new.jpg'),
}))
vi.mock('@/lib/users/avatar', () => avatars)
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'member', permissions: ['profile.update'] },
  }),
}))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  auditRequest: (
    _request: Request,
    _options: unknown,
    handle: () => Promise<Response>
  ) => handle(),
}))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=',
  'base64'
)
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(18),
])

/** A form whose `file` is an upload of `type`, or a text field without one. */
function form(bytes: Buffer | string, type?: string) {
  const data = new FormData()
  if (type === undefined) data.set('file', String(bytes))
  else
    data.set(
      'file',
      new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], {
        type,
      }),
      'avatar'
    )
  return data
}

function upload(body: FormData | Omit<RequestInit, 'method'>) {
  return uploadRoute(
    new Request('http://localhost/api/profile/avatar', {
      method: 'POST',
      ...(body instanceof FormData ? { body } : body),
    })
  )
}

afterEach(() => avatars.uploadAvatar.mockClear())

describe('avatar policy shared by the profile control and the upload route', () => {
  it('accepts the four formats every browser shows, up to 2 MB', () => {
    for (const type of AVATAR_ACCEPT.split(','))
      expect(avatarProblem({ size: AVATAR_MAX_BYTES, type })).toBeNull()
    expect(
      avatarProblem({ size: AVATAR_MAX_BYTES + 1, type: 'image/png' })
    ).toEqual({
      status: 413,
      title: 'File too large',
      message: 'Please upload an image of at most 2 MB.',
    })
    for (const type of ['image/svg+xml', 'image/heic', 'text/plain', ''])
      expect(avatarProblem({ size: 10, type })).toEqual({
        status: 415,
        title: 'Invalid file type',
        message: 'Please upload a PNG, JPEG, GIF, or WebP image.',
      })
  })

  it('publishes an image whose content is an accepted format', async () => {
    for (const [bytes, type] of [
      [png, 'image/png'],
      [jpeg, 'image/jpeg'],
      [gif, 'image/gif'],
      [webp, 'image/webp'],
      // Avatars are stored and served as JPEG, whatever the browser named.
      [jpeg, 'image/png'],
    ] as const) {
      const response = await upload({
        headers: { Origin: 'http://localhost' },
        body: form(bytes, type),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        success: true,
        url: '/api/avatars/new.jpg',
      })
      expect(avatars.uploadAvatar).toHaveBeenLastCalledWith('member', bytes)
    }
  })

  it('refuses other origins, non-form bodies, and oversized, unaccepted or non-image files before storing them', async () => {
    const endless = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024))
      },
    })
    const multipart = { 'content-type': 'multipart/form-data; boundary=x' }
    const cases: [Promise<Response>, number, string][] = [
      [
        upload({
          headers: { Origin: 'https://attacker.test' },
          body: form(png, 'image/png'),
        }),
        403,
        'Cross-origin requests are not allowed.',
      ],
      [
        upload({
          headers: { 'Sec-Fetch-Site': 'cross-site' },
          body: form(png, 'image/png'),
        }),
        403,
        'Cross-origin requests are not allowed.',
      ],
      [
        upload({
          headers: { 'content-type': 'image/png' },
          body: new Uint8Array(png),
        }),
        415,
        'Use multipart/form-data.',
      ],
      [
        upload({ body: new URLSearchParams({ file: 'not an uploaded file' }) }),
        415,
        'Use multipart/form-data.',
      ],
      [
        upload({
          headers: {
            ...multipart,
            'content-length': String(AVATAR_MAX_BYTES * 4),
          },
          body: 'not read',
        }),
        413,
        'Request body is too large.',
      ],
      [
        upload({ headers: multipart, body: endless, duplex: 'half' } as Omit<
          RequestInit,
          'method'
        >),
        413,
        'Request body is too large.',
      ],
      [
        upload(
          form(
            Buffer.concat([png, Buffer.alloc(AVATAR_MAX_BYTES)]),
            'image/png'
          )
        ),
        413,
        'Please upload an image of at most 2 MB.',
      ],
      [
        upload(
          form('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')
        ),
        415,
        'Please upload a PNG, JPEG, GIF, or WebP image.',
      ],
      [
        upload(form('plain text', 'text/plain')),
        415,
        'Please upload a PNG, JPEG, GIF, or WebP image.',
      ],
      [
        upload(form('<html>not an image</html>', 'image/png')),
        400,
        'File content is not a PNG, JPEG, GIF, or WebP image.',
      ],
      [
        upload(form(Buffer.from('BM fixture bitmap'), 'image/gif')),
        400,
        'File content is not a PNG, JPEG, GIF, or WebP image.',
      ],
      [upload(form('not an uploaded file')), 400, 'No file provided'],
    ]
    for (const [pending, status, error] of cases) {
      const response = await pending
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
    }
    expect(avatars.uploadAvatar).not.toHaveBeenCalled()
  })
})

describe('profile updates', () => {
  it('drop an image field; only the avatar route sets the avatar', () => {
    expect(
      UpdateProfileSchema.parse({
        name: 'Member',
        image: 'https://attacker.test/avatar.png',
      })
    ).toEqual({ name: 'Member' })
  })
})
