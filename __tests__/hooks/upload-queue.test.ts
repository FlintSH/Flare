import type { ReactElement } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UploadOptions, UploadResponse } from '@/lib/uploads/client'

import { useUploadQueue } from '@/hooks/use-upload-queue'

const harness = vi.hoisted(() => ({
  toast: vi.fn(),
  refresh: vi.fn(),
  upload: vi.fn(),
}))

// One render is enough: the hook's actions work on the queue, not on render state.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    vi.fn(),
  ],
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useEffect: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: harness.refresh }),
}))
vi.mock('@/hooks/use-toast', () => ({ toast: harness.toast }))
vi.mock('@/lib/uploads/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/client')>()),
  uploadFile: harness.upload,
}))

type Uploading = {
  file: File
  options: UploadOptions
  resolve: (response: UploadResponse) => void
  reject: (error: Error) => void
}
let uploading: Uploading[]

const response = (file: File): UploadResponse => ({
  url: `https://files.example/alice/${file.name}`,
  pageUrl: `https://files.example/alice/${file.name}`,
  name: file.name,
  size: file.size,
  type: 'text/plain',
})
const file = (name: string) => new File(['hello'], name, { type: 'text/plain' })
const lastToast = () =>
  harness.toast.mock.calls.at(-1)![0] as {
    title: string
    description?: string
    variant?: string
    action?: ReactElement<{ onClick: () => void; children: unknown }>
  }
const filesChanged = vi.fn()

beforeEach(() => {
  uploading = []
  vi.clearAllMocks()
  harness.upload.mockImplementation(
    (file: File, options: UploadOptions) =>
      new Promise((resolve, reject) =>
        uploading.push({ file, options, resolve, reject })
      )
  )
  const page = new EventTarget()
  page.addEventListener('flare:files-changed', filesChanged)
  vi.stubGlobal('window', Object.assign(page, { open: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function started() {
  await vi.waitFor(() => expect(uploading.length).toBeGreaterThan(0))
  return uploading.shift()!
}

describe('useUploadQueue', () => {
  it('announces finished uploads and refreshes the library', async () => {
    const queue = useUploadQueue()
    const batch = queue.uploadFiles([file('a.txt')], {})
    const upload = await started()
    upload.resolve(response(upload.file))
    await batch

    expect(lastToast()).toMatchObject({
      title: 'Upload complete',
      description: 'Successfully uploaded a.txt',
    })
    expect(harness.refresh).toHaveBeenCalledTimes(1)
    expect(filesChanged).toHaveBeenCalledTimes(1)
  })

  it('offers Retry after a dropped batch fails, for exactly the files left and the same destination', async () => {
    const queue = useUploadQueue()
    const [first, second, third] = [file('a.txt'), file('b.txt'), file('c.txt')]
    const batch = queue.uploadFiles([first, second, third], {
      folderId: 'folder-1',
    })
    const upload = await started()
    upload.resolve(response(first))
    ;(await started()).reject(new Error('Network error occurred'))
    await batch

    const failure = lastToast()
    expect(failure).toMatchObject({
      title: 'Upload failed',
      description:
        '1 file uploaded. Network error occurred. Retry the remaining files.',
      variant: 'destructive',
    })
    expect(failure.action?.props.children).toBe('Retry')

    failure.action!.props.onClick()
    const retried = [await started()]
    retried[0].resolve(response(second))
    retried.push(await started())
    retried[1].resolve(response(third))
    expect(retried.map(({ file }) => file)).toEqual([second, third])
    expect(retried.map(({ options }) => options)).toEqual([
      { folderId: 'folder-1' },
      { folderId: 'folder-1' },
    ])
    await vi.waitFor(() =>
      expect(lastToast()).toMatchObject({
        title: 'Upload complete',
        description: 'Successfully uploaded 2 files',
      })
    )
  })

  it('does not retry while another batch is running', async () => {
    const queue = useUploadQueue()
    const failed = queue.uploadFiles([file('a.txt')], {})
    ;(await started()).reject(new Error('Network error occurred'))
    await failed
    const retry = lastToast().action!.props.onClick

    const running = queue.uploadFiles([file('new.txt')], {})
    const upload = await started()
    retry()
    expect(lastToast()).toMatchObject({
      title: 'An upload is already in progress',
    })
    upload.resolve(response(upload.file))
    await running
    expect(harness.upload).toHaveBeenCalledTimes(2)
  })

  it('keeps the form’s unsent files queued instead of offering Retry', async () => {
    const queue = useUploadQueue()
    queue.add([file('a.txt')], 100)
    const batch = queue.upload({ visibility: 'PRIVATE' })
    ;(await started()).reject(new Error('Network error occurred'))
    await expect(batch).resolves.toMatchObject({
      failure: { message: 'Network error occurred' },
    })
    expect(lastToast().action).toBeUndefined()
    expect(harness.refresh).not.toHaveBeenCalled()
  })

  it('returns the files over the maximum size instead of queueing them', () => {
    const queue = useUploadQueue()
    const tooLarge = file('a.txt')
    expect(queue.add([tooLarge], 4)).toEqual([tooLarge])
  })
})
