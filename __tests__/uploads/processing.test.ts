import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ocr: vi.fn(async () => undefined),
  poster: vi.fn(async () => null),
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: mocks.ocr } }))
vi.mock('@/lib/files/video-poster', () => ({ videoPoster: mocks.poster }))

const { enqueueUploadProcessing } = await import('@/lib/uploads/finalize')

beforeEach(() => vi.clearAllMocks())

describe('work started once an upload is published', () => {
  it('makes a video’s frame right away, and reads no text from it', () => {
    const clip = {
      id: 'clip',
      path: 'uploads/a/clip.mp4',
      mimeType: 'video/mp4',
    }
    enqueueUploadProcessing(clip)
    expect(mocks.poster).toHaveBeenCalledExactlyOnceWith(clip)
    expect(mocks.ocr).not.toHaveBeenCalled()
  })

  it('reads text from an image and makes no frame', () => {
    enqueueUploadProcessing({
      id: 'photo',
      path: 'uploads/a/photo.png',
      mimeType: 'image/png',
    })
    expect(mocks.ocr).toHaveBeenCalledOnce()
    expect(mocks.poster).not.toHaveBeenCalled()
  })

  it('makes no frame of TypeScript saved as an MPEG stream', () => {
    enqueueUploadProcessing({
      id: 'code',
      name: 'index.ts',
      path: 'uploads/a/index.ts',
      mimeType: 'video/mp2t',
    })
    expect(mocks.poster).not.toHaveBeenCalled()
  })
})
