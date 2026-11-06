import { describe, expect, it } from 'vitest'

import { contentDisposition } from '@/lib/files/content-disposition'
import { isMissingObject } from '@/lib/storage/missing'
import { S3StorageProvider } from '@/lib/storage/providers/s3'

describe('contentDisposition', () => {
  it('keeps the header the file routes have always sent for ordinary names', () => {
    expect(contentDisposition('Screen shot 1.png', 'inline')).toBe(
      `inline; filename="Screen%20shot%201.png"; filename*=UTF-8''Screen%20shot%201.png`
    )
  })

  it('encodes quotes and non-ASCII, and escapes what RFC 5987 reserves', () => {
    expect(contentDisposition(`it's "Q3" (2)*.pdf`, 'attachment')).toBe(
      `attachment; filename="it's%20%22Q3%22%20(2)*.pdf"; filename*=UTF-8''it%27s%20%22Q3%22%20%282%29%2A.pdf`
    )
    expect(contentDisposition('café 日本.txt', 'attachment')).toBe(
      `attachment; filename="caf%C3%A9%20%E6%97%A5%E6%9C%AC.txt"; filename*=UTF-8''caf%C3%A9%20%E6%97%A5%E6%9C%AC.txt`
    )
  })

  it('names only the last path segment, without control characters', () => {
    expect(contentDisposition('docs/2026/report\r\n.txt', 'inline')).toBe(
      `inline; filename="report.txt"; filename*=UTF-8''report.txt`
    )
    expect(contentDisposition('folder/', 'attachment')).toBe(
      `attachment; filename="folder"; filename*=UTF-8''folder`
    )
    expect(contentDisposition('', 'attachment')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`
    )
  })

  it('keeps dots, which a name in this header can’t use to leave a directory', () => {
    expect(contentDisposition('docs/notes..txt', 'attachment')).toBe(
      `attachment; filename="notes..txt"; filename*=UTF-8''notes..txt`
    )
  })
})

describe('S3 download redirects', () => {
  it('ask S3 for the same encoded attachment header Flare sends', async () => {
    const provider = new S3StorageProvider({
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'public-test-key',
      secretAccessKey: 'public-test-secret',
      endpoint: 'http://127.0.0.1:9',
      forcePathStyle: true,
    })
    const name = 'Q3 "final" – café.txt'
    const url = new URL(
      await provider.getDownloadUrl('uploads/abc12/key/file.txt', name)
    )
    expect(url.searchParams.get('response-content-disposition')).toBe(
      contentDisposition(name, 'attachment')
    )
  })
})

describe('isMissingObject', () => {
  const named = (name: string) => Object.assign(new Error('failed'), { name })

  it.each([
    [
      'a missing local file',
      Object.assign(new Error('gone'), { code: 'ENOENT' }),
    ],
    ['an S3 GET for a missing key', named('NoSuchKey')],
    ['an S3 HEAD for a missing key', named('NotFound')],
  ])('recognizes %s', (_label, error) => {
    expect(isMissingObject(error)).toBe(true)
  })

  it.each([
    ['a missing bucket', named('NoSuchBucket')],
    ['a permission error', Object.assign(new Error('no'), { code: 'EACCES' })],
    ['a message that merely mentions NoSuchKey', new Error('NoSuchKey: x')],
    ['nothing', undefined],
    ['null', null],
  ])('does not treat %s as missing', (_label, error) => {
    expect(isMissingObject(error)).toBe(false)
  })
})
