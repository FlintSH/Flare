import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UploadOptions, UploadResponse } from '@/lib/uploads/client'
import { createUploadQueue, uploadActivity } from '@/lib/uploads/queue'

type Sending = {
  file: File
  options: UploadOptions
  progress: (bytes: number) => void
  succeed: () => void
  fail: (error: unknown) => void
}

/** A stand-in for the upload client whose uploads the test finishes. */
function fakeClient() {
  const sending: Sending[] = []
  const send = vi.fn(
    (file: File, options: UploadOptions, progress?: (bytes: number) => void) =>
      new Promise<UploadResponse>((resolve, reject) => {
        sending.push({
          file,
          options,
          progress: (bytes) => progress?.(bytes),
          succeed: () => resolve(response(file)),
          fail: reject,
        })
      })
  )
  /** The upload in flight, once the queue has started it. */
  const next = async () => {
    await vi.waitFor(() => expect(sending.length).toBeGreaterThan(0))
    return sending.shift()!
  }
  return { send, next }
}

const response = (file: File): UploadResponse => ({
  url: `https://files.example/alice/${file.name}`,
  name: file.name,
  size: file.size,
  type: file.type || 'application/octet-stream',
})
const file = (name: string, bytes = 10, type = 'text/plain') =>
  new File([new Uint8Array(bytes)], name, { type })
const names = (files: readonly { file: File }[]) =>
  files.map((item) => item.file.name)

let revoked: string[]

beforeEach(() => {
  revoked = []
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revoked.push(url)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('an upload queue', () => {
  it('queues files within the maximum size, with previews for images only', () => {
    const queue = createUploadQueue()
    const tooLarge = file('huge.txt', 101)
    expect(
      queue.add(
        [file('photo.png', 10, 'image/png'), tooLarge, file('a.txt')],
        100
      )
    ).toEqual([tooLarge])
    const [photo, text] = queue.getState().files
    expect(names(queue.getState().files)).toEqual(['photo.png', 'a.txt'])
    expect(photo.preview).toMatch(/^blob:/)
    expect(text.preview).toBeUndefined()

    queue.remove(photo.key)
    expect(revoked).toEqual([photo.preview])
    expect(names(queue.getState().files)).toEqual(['a.txt'])
    queue.clear()
    expect(queue.getState().files).toEqual([])
  })

  it('sends the queued files in order with the same options and empties on success', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    queue.add([file('photo.png', 10, 'image/png'), file('b.txt')], 100)
    const preview = queue.getState().files[0].preview
    const options = { folderId: 'folder-1', visibility: 'PRIVATE' } as const

    const batch = queue.upload(options)
    expect(queue.getState().uploading).toBe(true)
    const first = await client.next()
    first.succeed()
    const second = await client.next()
    second.succeed()

    await expect(batch).resolves.toEqual({
      uploaded: [response(first.file), response(second.file)],
    })
    expect([first.options, second.options]).toEqual([options, options])
    expect(queue.getState()).toEqual({ files: [], uploading: false })
    expect(revoked).toEqual([preview])
  })

  it('keeps the file that failed and the ones after it, and says what happened', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    queue.add([file('a.txt'), file('b.txt'), file('c.txt')], 100)

    const batch = queue.upload({})
    ;(await client.next()).succeed()
    const failed = await client.next()
    failed.progress(4)
    failed.fail(new Error('Network error occurred'))

    const result = await batch
    expect(result?.uploaded.map(({ name }) => name)).toEqual(['a.txt'])
    expect(result?.failure).toEqual({
      message:
        '1 file uploaded. Network error occurred. Retry the remaining files.',
      remaining: [failed.file, queue.getState().files[1].file],
    })
    expect(names(queue.getState().files)).toEqual(['b.txt', 'c.txt'])
    expect(queue.getState().uploading).toBe(false)
  })

  it.each([
    [
      1,
      'The file would exceed your storage quota.',
      '1 file uploaded. The file would exceed your storage quota. Retry the remaining files.',
    ],
    [
      2,
      'Upload failed: Bad Gateway',
      '2 files uploaded. Upload failed: Bad Gateway. Retry the remaining files.',
    ],
  ])(
    'ends the reason with one period after %i sent files: %j',
    async (sent, reason, message) => {
      const client = fakeClient()
      const queue = createUploadQueue(client.send)
      const files = Array.from({ length: sent + 1 }, (_, n) => file(`${n}.txt`))
      const batch = queue.uploadFiles(files, {})
      for (let n = 0; n < sent; n++) (await client.next()).succeed()
      ;(await client.next()).fail(new Error(reason))
      await expect(batch).resolves.toMatchObject({ failure: { message } })
    }
  )

  it('reports a failure of the first file as it is', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    const batch = queue.uploadFiles([file('a.txt')], {})
    ;(await client.next()).fail('not an error')
    await expect(batch).resolves.toMatchObject({
      uploaded: [],
      failure: { message: 'Upload failed' },
    })
  })

  it('tracks each queued file’s progress and starts a retried file from zero', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    queue.add([file('a.txt', 10)], 100)

    let batch = queue.upload({})
    let sending = await client.next()
    sending.progress(4)
    expect(queue.getState().files[0]).toMatchObject({
      uploaded: 4,
      progress: 40,
    })
    sending.fail(new Error('Network error occurred'))
    await batch

    batch = queue.upload({})
    sending = await client.next()
    expect(queue.getState().files[0]).toMatchObject({
      uploaded: 0,
      progress: 0,
    })
    sending.succeed()
    await batch
  })

  it('measures the speed of the file being sent', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    queue.add([file('big.bin', 4000)], 10_000)

    const batch = queue.upload({})
    const sending = await client.next()
    expect(queue.getState().files[0].speed).toBeNull()
    expect(uploadActivity.get().file).toMatchObject({
      size: 4000,
      uploaded: 0,
      speed: null,
    })
    now = 1000
    sending.progress(2000)
    expect(queue.getState().files[0]).toMatchObject({
      uploaded: 2000,
      speed: 2000,
    })
    expect(uploadActivity.get().file).toMatchObject({
      uploaded: 2000,
      progress: 50,
      speed: 2000,
    })
    sending.succeed()
    await batch
  })

  it('runs one batch at a time', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    queue.add([file('a.txt')], 100)
    const batch = queue.upload({})
    await expect(queue.upload({})).resolves.toBeNull()
    await expect(queue.uploadFiles([file('b.txt')], {})).resolves.toBeNull()
    ;(await client.next()).succeed()
    await batch
    expect(client.send).toHaveBeenCalledTimes(1)
    await expect(queue.upload({})).resolves.toBeNull()
  })

  it('leaves nothing waiting after a one-off batch, so a later drop sends only its own files', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    const old = file('rejected.exe')

    const first = queue.uploadFiles([old], {})
    ;(await client.next()).fail(new Error('This file type is not allowed.'))
    await expect(first).resolves.toMatchObject({
      failure: { message: 'This file type is not allowed.', remaining: [old] },
    })
    expect(queue.getState().files).toEqual([])

    const fresh = file('report.pdf')
    const second = queue.uploadFiles([fresh], { folderId: 'folder-1' })
    const sending = await client.next()
    expect(sending.file).toBe(fresh)
    sending.succeed()
    await expect(second).resolves.toEqual({ uploaded: [response(fresh)] })
    expect(client.send).toHaveBeenCalledTimes(2)
  })
})

describe('upload activity', () => {
  it('follows the file being sent and keeps the last one after the batch', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    const seen: string[] = []
    const stop = uploadActivity.subscribe(() => {
      const { file, uploading } = uploadActivity.get()
      seen.push(`${uploading ? 'up' : 'idle'} ${file?.name} ${file?.progress}`)
    })

    const batch = queue.uploadFiles(
      [file('a.txt', 10), file('empty.txt', 0)],
      {}
    )
    const first = await client.next()
    first.progress(5)
    first.succeed()
    ;(await client.next()).succeed()
    await batch
    stop()

    expect(seen).toEqual([
      'up a.txt 0',
      'up a.txt 50',
      'up empty.txt 0',
      'idle empty.txt 0',
    ])
  })

  it('stops showing progress when a batch fails', async () => {
    const client = fakeClient()
    const queue = createUploadQueue(client.send)
    const batch = queue.uploadFiles([file('a.txt')], {})
    ;(await client.next()).fail(new Error('Network error occurred'))
    await batch
    expect(uploadActivity.get()).toMatchObject({
      uploading: false,
      file: { name: 'a.txt' },
    })
  })

  it('belongs to the most recent file when two queues upload at once', async () => {
    const client = fakeClient()
    const form = createUploadQueue(client.send)
    const dropZone = createUploadQueue(client.send)

    const formBatch = form.uploadFiles([file('form.txt')], {})
    const fromForm = await client.next()
    const dropBatch = dropZone.uploadFiles([file('drop.txt')], {})
    const fromDrop = await client.next()

    fromForm.progress(5)
    expect(uploadActivity.get().file?.name).toBe('drop.txt')
    fromForm.succeed()
    await formBatch
    expect(uploadActivity.get()).toMatchObject({
      uploading: true,
      file: { name: 'drop.txt' },
    })
    fromDrop.succeed()
    await dropBatch
    expect(uploadActivity.get().uploading).toBe(false)
  })
})
