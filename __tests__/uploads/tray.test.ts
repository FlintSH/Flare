import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadActivity } from '@/lib/uploads/activity'
import {
  UploadFailure,
  type UploadOptions,
  type UploadResponse,
  uploadCancelled,
} from '@/lib/uploads/client'
import { type TrayOutcome, createUploadTray } from '@/lib/uploads/tray'

type Sending = {
  file: File
  options: UploadOptions
  signal?: AbortSignal
  progress: (bytes: number) => void
  succeed: () => void
  fail: (error: unknown) => void
}

/** A stand-in for the upload client whose uploads the test finishes. */
function fakeClient() {
  const sending: Sending[] = []
  const send = vi.fn(
    (
      file: File,
      options: UploadOptions,
      progress?: (bytes: number) => void,
      signal?: AbortSignal
    ) =>
      new Promise<UploadResponse>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(uploadCancelled()))
        sending.push({
          file,
          options,
          signal,
          progress: (bytes) => progress?.(bytes),
          succeed: () => resolve(response(file)),
          fail: reject,
        })
      })
  )
  const next = async () => {
    await vi.waitFor(() => expect(sending.length).toBeGreaterThan(0))
    return sending.shift()!
  }
  return { send, next, sending }
}

const response = (file: File): UploadResponse => ({
  id: `id-${file.name}`,
  url: `https://files.example/alice/${file.name}`,
  pageUrl: `https://files.example/alice/${file.name}`,
  name: file.name,
  size: file.size,
  type: file.type || 'application/octet-stream',
})
const file = (name: string, bytes = 10, type = 'text/plain') =>
  new File([new Uint8Array(bytes)], name, { type })

const PUBLIC: TrayOutcome = {
  visibility: 'PUBLIC',
  expires: null,
  password: false,
  folder: null,
}
const publicly = (options: UploadOptions = {}) => ({
  options,
  outcome: PUBLIC,
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('upload tray', () => {
  it('starts files as they are added, one at a time, with their own settings', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add(
      [file('a.txt'), file('b.txt')],
      100,
      publicly({ visibility: 'PUBLIC' })
    )
    const first = await client.next()
    expect(first.file.name).toBe('a.txt')
    expect(client.sending).toHaveLength(0)
    // A change of settings applies to what is added next, not to b.txt.
    tray.add([file('c.txt')], 100, publicly({ visibility: 'PRIVATE' }))
    first.succeed()
    const second = await client.next()
    expect(second.file.name).toBe('b.txt')
    expect(second.options.visibility).toBe('PUBLIC')
    second.succeed()
    const third = await client.next()
    expect(third.options.visibility).toBe('PRIVATE')
    third.succeed()
    await vi.waitFor(() =>
      expect(tray.getState().files.every((f) => f.status === 'done')).toBe(true)
    )
    expect(tray.getState().files.map((f) => f.result?.id)).toEqual([
      'id-a.txt',
      'id-b.txt',
      'id-c.txt',
    ])
  })

  it('puts files added while others are going in their batch, and later ones in a new one', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt')], 100, publicly())
    tray.add([file('b.txt')], 100, publicly())
    ;(await client.next()).succeed()
    ;(await client.next()).succeed()
    await vi.waitFor(() =>
      expect(tray.getState().files.every((f) => f.status === 'done')).toBe(true)
    )
    tray.add([file('c.txt')], 100, publicly())
    ;(await client.next()).succeed()
    await settle()
    expect(tray.getState().files.map((f) => f.batch)).toEqual([1, 1, 2])
    expect(tray.getState().batch).toBe(2)
  })

  it('refuses files over the limit and keeps the rest', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    const refused = tray.add(
      [file('big.bin', 500), file('ok.txt')],
      100,
      publicly()
    )
    expect(refused.map((f) => f.name)).toEqual(['big.bin'])
    expect(tray.getState().files.map((f) => f.name)).toEqual(['ok.txt'])
  })

  it('stops at a failure until it is retried, and keeps the files behind it waiting', async () => {
    const client = fakeClient()
    const settled = vi.fn()
    const tray = createUploadTray(client.send)
    tray.onSettled(settled)
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    ;(await client.next()).fail(new Error('Storage quota exceeded'))
    await vi.waitFor(() => expect(tray.getState().pausedBy !== null).toBe(true))
    expect(tray.getState().files.map((f) => [f.status, f.reason])).toEqual([
      ['failed', 'Storage quota exceeded'],
      ['waiting', undefined],
    ])
    expect(settled).toHaveBeenCalledWith({
      uploaded: [],
      failure: { name: 'a.txt', reason: 'Storage quota exceeded' },
    })
    tray.retry(tray.getState().files[0]!.key)
    ;(await client.next()).succeed()
    ;(await client.next()).succeed()
    await vi.waitFor(() =>
      expect(tray.getState().files.every((f) => f.status === 'done')).toBe(true)
    )
    expect(tray.getState().pausedBy !== null).toBe(false)
  })

  it('goes on without a failed file once it is removed', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    ;(await client.next()).fail(new Error('Nope'))
    await vi.waitFor(() => expect(tray.getState().pausedBy !== null).toBe(true))
    tray.remove(tray.getState().files[0]!.key)
    const next = await client.next()
    expect(next.file.name).toBe('b.txt')
  })

  it('cancels the file being sent and goes on with the next', async () => {
    const client = fakeClient()
    const settled = vi.fn()
    const tray = createUploadTray(client.send)
    tray.onSettled(settled)
    tray.add([file('huge.mov'), file('b.txt')], 100, publicly())
    const first = await client.next()
    first.progress(4)
    await vi.waitFor(() =>
      expect(tray.getState().files[0]).toMatchObject({
        status: 'sending',
        progress: 40,
      })
    )
    tray.cancel(tray.getState().files[0]!.key)
    expect(first.signal?.aborted).toBe(true)
    const second = await client.next()
    expect(second.file.name).toBe('b.txt')
    expect(tray.getState().files.map((f) => f.name)).toEqual(['b.txt'])
    second.succeed()
    await vi.waitFor(() => expect(settled).toHaveBeenCalled())
    // A cancellation is not a failure.
    expect(settled.mock.calls[0]![0].failure).toBeUndefined()
  })

  it('cancels a waiting file without sending it', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    const first = await client.next()
    tray.cancel(tray.getState().files[1]!.key)
    first.succeed()
    await settle()
    await settle()
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(tray.getState().files.map((f) => f.name)).toEqual(['a.txt'])
  })

  it('holds files while settings would fail, and sends them once they are fixed', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt')], 100, { held: 'Check the password.' })
    await settle()
    expect(client.send).not.toHaveBeenCalled()
    expect(tray.getState().files[0]).toMatchObject({
      status: 'held',
      reason: 'Check the password.',
    })
    tray.release({
      held: 'That folder is no longer available. Choose another.',
    })
    expect(tray.getState().files[0]!.reason).toMatch(/folder/)
    tray.release(publicly({ password: 'long enough secret' }))
    const sent = await client.next()
    expect(sent.options.password).toBe('long enough secret')
    expect(tray.getState().files[0]!.outcome).toEqual(PUBLIC)
  })

  it('clears finished files and leaves the ones still going', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    ;(await client.next()).succeed()
    await client.next()
    await vi.waitFor(() =>
      expect(tray.getState().files[0]!.status).toBe('done')
    )
    tray.clear()
    expect(tray.getState().files.map((f) => f.name)).toEqual(['b.txt'])
  })

  it('reports progress to the progress card and lets it go when done', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt')], 100, publicly())
    const first = await client.next()
    first.progress(5)
    expect(uploadActivity.get()).toMatchObject({
      uploading: true,
      file: { name: 'a.txt', progress: 50 },
    })
    first.succeed()
    await vi.waitFor(() => expect(uploadActivity.get().uploading).toBe(false))
  })

  it('goes on past a file the server refuses on its own account', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('bad.exe'), file('b.txt')], 100, publicly())
    ;(await client.next()).fail(
      new UploadFailure('That file type is blocked.', 400)
    )
    const next = await client.next()
    expect(next.file.name).toBe('b.txt')
    expect(tray.getState().pausedBy !== null).toBe(false)
    expect(tray.getState().files[0]).toMatchObject({
      status: 'failed',
      reason: 'That file type is blocked.',
    })
  })

  it.each([
    [new UploadFailure('This would exceed your storage quota.', 413), true],
    [new UploadFailure('Your role no longer allows this upload.', 403), true],
    [new UploadFailure('Upload could not be completed.', 500), true],
    [new Error('Network error occurred'), true],
    [new UploadFailure('Invalid filename.', 400), false],
    [new UploadFailure('A file exceeds the upload size limit.', 413), false],
  ])('pauses the line for %s: %s', async (error, pauses) => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    ;(await client.next()).fail(error)
    await vi.waitFor(() =>
      expect(tray.getState().files[0]!.status).toBe('failed')
    )
    await settle()
    expect(tray.getState().pausedBy !== null).toBe(pauses)
    expect(client.sending.length).toBe(pauses ? 0 : 1)
  })

  it('drops another account’s files when the tab changes hands', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.claim('alice')
    tray.add([file('a.txt'), file('b.txt')], 100, publicly())
    const first = await client.next()
    tray.claim('alice')
    expect(tray.getState().files).toHaveLength(2)
    tray.claim('bob')
    expect(first.signal?.aborted).toBe(true)
    expect(tray.getState().files).toHaveLength(0)
  })

  it('keeps the latest hundred finished files', async () => {
    const tray = createUploadTray(async (sent) => response(sent))
    const many = Array.from({ length: 105 }, (_, index) => file(`${index}.txt`))
    tray.add(many, 100, publicly())
    await vi.waitFor(() =>
      expect(tray.getState().files.every((f) => f.status === 'done')).toBe(true)
    )
    await settle()
    const names = tray.getState().files.map((f) => f.name)
    expect(names).toHaveLength(100)
    expect(names[0]).toBe('5.txt')
  })

  it('records a change made to a sent file', async () => {
    const tray = createUploadTray(async (sent) => response(sent))
    tray.add([file('a.txt')], 100, publicly())
    await vi.waitFor(() =>
      expect(tray.getState().files[0]!.status).toBe('done')
    )
    tray.amend(tray.getState().files[0]!.key, { visibility: 'PRIVATE' })
    expect(tray.getState().files[0]!.outcome?.visibility).toBe('PRIVATE')
  })

  it('names the failure that stopped the line, past one that didn’t', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('bad.exe'), file('b.txt'), file('c.txt')], 100, publicly())
    ;(await client.next()).fail(
      new UploadFailure('That file type is blocked.', 400)
    )
    ;(await client.next()).fail(new Error('Network error occurred'))
    await vi.waitFor(() => expect(tray.getState().pausedBy).not.toBeNull())
    const [refused, lost] = tray.getState().files
    expect(tray.getState().pausedBy).toBe(lost!.key)
    tray.retry(tray.getState().pausedBy!)
    expect((await client.next()).file.name).toBe('b.txt')
    expect(tray.getState().files[0]).toMatchObject({
      key: refused!.key,
      status: 'failed',
    })
  })

  it('closes a batch once nothing in it waits, even with a refused file', async () => {
    const client = fakeClient()
    const tray = createUploadTray(client.send)
    tray.add([file('bad.exe')], 100, publicly())
    ;(await client.next()).fail(
      new UploadFailure('That file type is blocked.', 400)
    )
    await vi.waitFor(() =>
      expect(tray.getState().files[0]!.status).toBe('failed')
    )
    tray.add([file('later.txt')], 100, publicly())
    expect(tray.getState().files.map((f) => f.batch)).toEqual([1, 2])
  })
})
