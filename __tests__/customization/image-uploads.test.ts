import { POST as uploadLogo } from '@/app/api/customization/assets/route'
import { describe, expect, it, vi } from 'vitest'

import { FAVICON_POLICY, faviconProblem } from '@/lib/customization/favicon'
import { imageProblem, imageType } from '@/lib/customization/image'
import {
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  isLogoDataUrl,
  logoProblem,
} from '@/lib/customization/logo'
import {
  DEFAULT_APPEARANCE,
  appearanceDocumentSchema,
} from '@/lib/customization/schema'
import { FORM_FRAMING_BYTES } from '@/lib/http/request'

vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'manager', permissions: ['appearance.manage'] },
  }),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
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
const webp = Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8 ', 'latin1')

describe('image formats', () => {
  it('tells PNG, JPEG, GIF and WebP apart by their first bytes', () => {
    expect(imageType(png)).toBe('image/png')
    expect(imageType(jpeg)).toBe('image/jpeg')
    expect(imageType(gif)).toBe('image/gif')
    expect(imageType(webp)).toBe('image/webp')
    for (const other of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('RIFF\x1a\x00\x00\x00WAVEfmt ', 'latin1'),
      png.subarray(0, 4),
      Buffer.alloc(0),
    ])
      expect(imageType(other)).toBeNull()
  })

  it('words a refusal by size first, then by the reported type', () => {
    expect(
      imageProblem(FAVICON_POLICY, { size: 2 * 1024 ** 2, type: 'image/gif' })
    ).toEqual(faviconProblem({ size: 2 * 1024 ** 2, type: 'image/png' }))
  })
})

describe('the logo policy the studio, the upload route and saved documents share', () => {
  it('takes PNG, JPEG or WebP of at most 256 KB', () => {
    expect(LOGO_ACCEPT).toBe('image/png,image/jpeg,image/webp')
    for (const type of LOGO_ACCEPT.split(','))
      expect(logoProblem({ size: LOGO_MAX_BYTES, type })).toBeNull()
    expect(
      logoProblem({ size: LOGO_MAX_BYTES + 1, type: 'image/png' })
    ).toEqual({
      status: 413,
      title: 'File too large',
      message: 'Please upload a logo of at most 256 KB.',
    })
    expect(logoProblem({ size: 10, type: 'image/gif' })).toEqual({
      status: 415,
      title: 'Invalid file type',
      message: 'Please upload a PNG, JPEG, or WebP image.',
    })
  })

  it('saves only data URLs holding a logo of the type they name', () => {
    const url = (type: string, bytes: Buffer) =>
      `data:${type};base64,${bytes.toString('base64')}`
    const valid = (logoLight: string) =>
      appearanceDocumentSchema.safeParse({
        ...DEFAULT_APPEARANCE,
        brand: { ...DEFAULT_APPEARANCE.brand, logoLight },
      }).success
    expect(valid('')).toBe(true)
    expect(isLogoDataUrl(url('image/png', png))).toBe(true)
    expect(isLogoDataUrl(url('image/jpeg', jpeg))).toBe(true)
    expect(isLogoDataUrl(url('image/webp', webp))).toBe(true)
    expect(valid(url('image/png', png))).toBe(true)
    for (const logo of [
      url('image/jpeg', png),
      url('image/gif', gif),
      url('image/png', Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)])),
      'data:image/png;base64,not base64',
    ]) {
      expect(isLogoDataUrl(logo)).toBe(false)
      expect(valid(logo)).toBe(false)
    }
  })
})

describe('logo uploads', () => {
  const address = 'http://localhost/api/customization/assets'

  function logo(bytes: Buffer, type: string) {
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'logo')
    return uploadLogo(new Request(address, { method: 'POST', body: form }))
  }

  it('turns a small image into a data URL of the type its bytes show', async () => {
    for (const reported of ['image/png', 'image/jpeg']) {
      const response = await logo(png, reported)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: { url: `data:image/png;base64,${png.toString('base64')}` },
      })
    }
  })

  it('answers each refusal as favicon uploads do', async () => {
    const form = new FormData()
    form.set('file', 'not an uploaded file')
    const cases: [Promise<Response>, number, string][] = [
      [
        uploadLogo(
          new Request(address, {
            method: 'POST',
            headers: {
              'content-type': 'multipart/form-data; boundary=form',
              'content-length': String(LOGO_MAX_BYTES + FORM_FRAMING_BYTES + 1),
            },
            body: 'not read',
          })
        ),
        413,
        'Request body is too large.',
      ],
      [
        logo(Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)]), 'image/png'),
        413,
        'Please upload a logo of at most 256 KB.',
      ],
      [
        logo(gif, 'image/gif'),
        415,
        'Please upload a PNG, JPEG, or WebP image.',
      ],
      [
        logo(Buffer.from('<svg/>'), 'image/png'),
        400,
        'File content is not a PNG, JPEG, or WebP image.',
      ],
      [
        uploadLogo(new Request(address, { method: 'POST', body: form })),
        400,
        'No file provided',
      ],
      [
        uploadLogo(
          new Request(address, {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=form' },
            body: 'not a multipart body',
          })
        ),
        400,
        'Invalid form data.',
      ],
    ]
    for (const [pending, status, error] of cases) {
      const response = await pending
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
    }
  })
})
