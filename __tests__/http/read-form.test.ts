import { describe, expect, it } from 'vitest'

import { readForm } from '@/lib/http/request'

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
