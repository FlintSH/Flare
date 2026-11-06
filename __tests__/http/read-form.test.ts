import { POST as uploadLogo } from '@/app/api/customization/assets/route'
import { describe, expect, it, vi } from 'vitest'

import { readForm } from '@/lib/http/request'

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

const multipart = { 'content-type': 'multipart/form-data; boundary=form' }

/** A body that never ends and states no length. */
function endless(url: string) {
  return new Request(url, {
    method: 'POST',
    headers: multipart,
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    }),
    duplex: 'half',
  } as RequestInit)
}

/** A body whose stated length is `length`; it is never read. */
function declared(url: string, length: number) {
  return new Request(url, {
    method: 'POST',
    headers: { ...multipart, 'content-length': String(length) },
    body: 'not read',
  })
}

describe('reading a form with a size limit', () => {
  it('parses a form within the limit', async () => {
    const form = new FormData()
    form.set('name', 'value')
    form.set('file', new Blob(['bytes'], { type: 'text/plain' }), 'note.txt')
    const parsed = await readForm(
      new Request('http://localhost/form', { method: 'POST', body: form }),
      { limit: 1024 }
    )
    expect(parsed.get('name')).toBe('value')
    const file = parsed.get('file')
    expect(file).toBeInstanceOf(File)
    expect((file as File).name).toBe('note.txt')
    expect(await (file as File).text()).toBe('bytes')
  })

  it('answers 413 for a larger body, whether or not it states its length', async () => {
    await expect(
      readForm(declared('http://localhost/form', 2048), {
        limit: 1024,
        tooLarge: 'That form is too large.',
      })
    ).rejects.toMatchObject({ status: 413, message: 'That form is too large.' })
    await expect(
      readForm(endless('http://localhost/form'), { limit: 1024 })
    ).rejects.toMatchObject({
      status: 413,
      message: 'Request body is too large.',
    })
  })

  it('answers 400 for a body that is not the form its content type names', async () => {
    await expect(
      readForm(
        new Request('http://localhost/form', {
          method: 'POST',
          headers: multipart,
          body: 'not a multipart body',
        }),
        { limit: 1024 }
      )
    ).rejects.toMatchObject({ status: 400, message: 'Invalid form data.' })
  })
})

describe('logo uploads keep their limit and messages', () => {
  const url = 'http://localhost/api/customization/assets'
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=',
    'base64'
  )
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')

  function logo(bytes: Buffer, type: string) {
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'logo')
    return uploadLogo(new Request(url, { method: 'POST', body: form }))
  }

  it('turns a small PNG into a data URL', async () => {
    const response = await logo(png, 'image/png')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { url: `data:image/png;base64,${png.toString('base64')}` },
    })
  })

  it('refuses bodies over 300,000 bytes, larger logos and other formats as before', async () => {
    const cases: [Promise<Response>, number, string][] = [
      [
        uploadLogo(declared(url, 300_001)),
        413,
        'Logos must be smaller than 256 KB.',
      ],
      [uploadLogo(endless(url)), 413, 'Logos must be smaller than 256 KB.'],
      [
        logo(Buffer.concat([png, Buffer.alloc(256 * 1024)]), 'image/png'),
        400,
        'Choose a PNG, JPEG, or WebP logo smaller than 256 KB.',
      ],
      [
        logo(gif, 'image/gif'),
        400,
        'Only PNG, JPEG, and WebP images are supported.',
      ],
      [
        uploadLogo(
          new Request(url, {
            method: 'POST',
            headers: multipart,
            body: 'not a multipart body',
          })
        ),
        400,
        'This image could not be read.',
      ],
    ]
    for (const [pending, status, error] of cases) {
      const response = await pending
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
    }
  })
})
