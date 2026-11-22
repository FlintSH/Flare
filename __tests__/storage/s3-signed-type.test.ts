import { describe, expect, it } from 'vitest'

import { S3StorageProvider } from '@/lib/storage/providers/s3'

// Signing happens locally: no request leaves the process.
const provider = () =>
  new S3StorageProvider({
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
  })

const typeIn = (url: string | null) =>
  new URL(url as string).searchParams.get('response-content-type')

describe('signed storage URLs', () => {
  it('send a file under the type Flare recorded for it', async () => {
    const s3 = provider()
    expect(
      typeIn(await s3.getPublicUrl('uploads/alexm/1/clip.mp4', 'video/mp4'))
    ).toBe('video/mp4')
    expect(
      typeIn(
        await s3.getDownloadUrl(
          'uploads/alexm/1/photo.png',
          'photo.png',
          'image/png'
        )
      )
    ).toBe('image/png')
  })

  it('leave the stored type alone when none is given', async () => {
    const s3 = provider()
    expect(typeIn(await s3.getPublicUrl('uploads/alexm/1/clip.mp4'))).toBeNull()
    expect(
      typeIn(await s3.getDownloadUrl('uploads/alexm/1/photo.png', 'photo.png'))
    ).toBeNull()
  })

  it('keeps the download name beside the type', async () => {
    const url = await provider().getDownloadUrl(
      'uploads/alexm/1/photo.png',
      'photo.png',
      'image/png'
    )
    expect(
      new URL(url).searchParams.get('response-content-disposition')
    ).toContain('photo.png')
  })
})
