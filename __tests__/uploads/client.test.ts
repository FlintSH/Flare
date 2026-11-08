import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { partitionBySize, uploadFile, uploadPaste } from '@/lib/uploads/client'

const MiB = 1024 * 1024
const REQUEST_TOO_LARGE =
  'The upload is larger than the server’s request size limit. Ask your administrator to raise it.'
const uploaded = {
  url: 'https://files.example/alice/note.txt',
  pageUrl: 'https://files.example/alice/note.txt',
  name: 'note.txt',
  size: 5,
  type: 'text/plain',
}

type ProgressListener = (event: {
  lengthComputable: boolean
  loaded: number
}) => void

/** Records each request; `server` answers it after the client has sent it. */
class FakeRequest {
  static sent: FakeRequest[] = []
  static inFlight = 0
  static mostInFlight = 0
  static server: (request: FakeRequest) => void = () => {}

  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown
  status = 0
  statusText = ''
  responseText = ''
  private listeners = new Map<string, (() => void)[]>()
  private progressListeners: ProgressListener[] = []
  upload = {
    addEventListener: (type: string, listener: ProgressListener) => {
      if (type === 'progress') this.progressListeners.push(listener)
    },
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
    FakeRequest.sent.push(this)
    FakeRequest.inFlight++
    FakeRequest.mostInFlight = Math.max(
      FakeRequest.mostInFlight,
      FakeRequest.inFlight
    )
    queueMicrotask(() => FakeRequest.server(this))
  }

  progress(loaded: number) {
    for (const listener of this.progressListeners)
      listener({ lengthComputable: true, loaded })
  }
  respond(status: number, body: unknown, statusText = '') {
    FakeRequest.inFlight--
    this.status = status
    this.statusText = statusText
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    for (const listener of this.listeners.get('load') ?? []) listener()
  }
  fail() {
    FakeRequest.inFlight--
    for (const listener of this.listeners.get('error') ?? []) listener()
  }
}

type Answer = (request: FakeRequest) => void

/** Answers the chunked endpoints: the start, each part, then completion. */
function chunkServer(
  answers: {
    init?: Answer
    part?: (request: FakeRequest, part: number) => void
    complete?: Answer
  } = {}
) {
  const init =
    answers.init ??
    ((request) =>
      request.respond(200, { data: { uploadId: 'abc123', fileKey: 'k' } }))
  const part =
    answers.part ??
    ((request, number) =>
      request.respond(200, { data: { etag: `"etag-${number}"` } }))
  // The completion route answers without the `data` envelope.
  const complete =
    answers.complete ?? ((request) => request.respond(200, uploaded))
  FakeRequest.server = (request) => {
    if (request.url === '/api/files/chunks') return init(request)
    const number = request.url.match(/\/part\/(\d+)$/)
    if (number) return part(request, Number(number[1]))
    complete(request)
  }
}

const fields = (request: FakeRequest) =>
  [...(request.body as FormData).entries()].map(([name, value]) => [
    name,
    value instanceof File ? `file:${value.name}` : value,
  ])
const sized = (bytes: number) =>
  new File([new Uint8Array(bytes)], 'big.bin', { type: 'application/zip' })
const small = () => new File(['hello'], 'note.txt', { type: 'text/plain' })

beforeEach(() => {
  FakeRequest.sent = []
  FakeRequest.inFlight = 0
  FakeRequest.mostInFlight = 0
  FakeRequest.server = (request) => request.respond(200, { data: uploaded })
  vi.stubGlobal('XMLHttpRequest', FakeRequest)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the size rule', () => {
  it('admits files up to the maximum and returns the rest', () => {
    const fits = sized(10)
    const over = sized(11)
    expect(partitionBySize([fits, over], 10)).toEqual({
      fitting: [fits],
      tooLarge: [over],
    })
  })
})

describe('whole-file uploads', () => {
  it('send options as form fields and the profile and folder as headers', async () => {
    await uploadFile(small(), {
      profileId: 'profile-1',
      folderId: 'folder-1',
      visibility: 'PRIVATE',
      password: 'correct horse',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      expiryAction: 'SET_PRIVATE',
    })
    const [request] = FakeRequest.sent
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/files')
    expect(request.headers).toEqual({
      'X-Upload-Profile': 'profile-1',
      'X-Upload-Folder': 'folder-1',
    })
    expect(fields(request)).toEqual([
      ['file', 'file:note.txt'],
      ['visibility', 'PRIVATE'],
      ['password', 'correct horse'],
      ['expiresAt', '2030-01-01T00:00:00.000Z'],
      ['expiryAction', 'SET_PRIVATE'],
    ])
  })

  it('leave inherited options out and send explicit "none" choices', async () => {
    await uploadFile(small(), {})
    await uploadFile(small(), {
      profileId: null,
      folderId: null,
      expiresAt: null,
    })
    const [inherited, explicit] = FakeRequest.sent
    expect(inherited.headers).toEqual({})
    expect(fields(inherited)).toEqual([['file', 'file:note.txt']])
    expect(explicit.headers).toEqual({ 'X-Upload-Profile': 'none' })
    expect(fields(explicit)).toEqual([
      ['file', 'file:note.txt'],
      ['expiresAt', ''],
    ])
  })

  it('report progress, then the whole file once the server accepts it', async () => {
    const progress: number[] = []
    FakeRequest.server = (request) => {
      request.progress(2)
      request.progress(5)
      request.respond(200, { data: uploaded })
    }
    await expect(
      uploadFile(small(), {}, (bytes) => progress.push(bytes))
    ).resolves.toEqual(uploaded)
    expect(progress).toEqual([2, 5, 5])
  })

  it('refuse a successful answer that is not an upload', async () => {
    FakeRequest.server = (request) => request.respond(200, '<html>ok</html>')
    await expect(uploadFile(small(), {})).rejects.toThrow(
      'Could not read the upload response.'
    )
  })

  it.each([
    [
      'Flare’s own message',
      413,
      { error: 'The file would exceed your storage quota.' },
      'Payload Too Large',
      'The file would exceed your storage quota.',
    ],
    [
      'the request size limit for a proxy’s 413',
      413,
      '<html><body>413 Request Entity Too Large</body></html>',
      'Request Entity Too Large',
      REQUEST_TOO_LARGE,
    ],
    [
      'the status of other answers without a message',
      502,
      '<html>Bad gateway</html>',
      'Bad Gateway',
      'Upload failed: Bad Gateway',
    ],
  ])('report %s', async (_case, status, body, statusText, message) => {
    FakeRequest.server = (request) => request.respond(status, body, statusText)
    await expect(uploadFile(small(), {})).rejects.toThrow(message)
  })

  it('report a lost connection', async () => {
    FakeRequest.server = (request) => request.fail()
    await expect(uploadFile(small(), {})).rejects.toThrow(
      'Network error occurred'
    )
  })
})

describe('chunked uploads', () => {
  it('send files up to 10 MiB in one request', async () => {
    await uploadFile(sized(10 * MiB), {})
    expect(FakeRequest.sent.map((request) => request.url)).toEqual([
      '/api/files',
    ])
  })

  it('start with the options in the JSON body', async () => {
    chunkServer()
    await uploadFile(sized(10 * MiB + 1), {
      profileId: null,
      visibility: 'PUBLIC',
      password: '',
      expiresAt: null,
    })
    const [start] = FakeRequest.sent
    expect(start.method).toBe('POST')
    expect(start.url).toBe('/api/files/chunks')
    expect(start.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(start.body as string)).toEqual({
      filename: 'big.bin',
      mimeType: 'application/zip',
      size: 10485761,
      profileId: null,
      folderId: null,
      visibility: 'PUBLIC',
      expiresAt: null,
    })
  })

  it('send 5 MiB parts, three at a time, and complete with the parts in order', async () => {
    const waiting: FakeRequest[] = []
    chunkServer({
      // Answer each group once all of it has arrived, last part first.
      part: (request) => {
        waiting.push(request)
        if (waiting.length < FakeRequest.inFlight) return
        for (const pending of waiting.splice(0).reverse()) {
          const number = Number(pending.url.split('/').pop())
          pending.progress(1)
          pending.respond(200, { data: { etag: `"etag-${number}"` } })
        }
      },
    })
    const file = sized(15 * MiB + 1)
    const progress: number[] = []
    await expect(
      uploadFile(file, { folderId: 'folder-1' }, (bytes) =>
        progress.push(bytes)
      )
    ).resolves.toEqual(uploaded)

    const parts = FakeRequest.sent.filter((request) => request.method === 'PUT')
    expect(parts.map((request) => request.url)).toEqual([
      '/api/files/chunks/abc123/part/1',
      '/api/files/chunks/abc123/part/2',
      '/api/files/chunks/abc123/part/3',
      '/api/files/chunks/abc123/part/4',
    ])
    expect(parts.map((request) => (request.body as Blob).size)).toEqual([
      5 * MiB,
      5 * MiB,
      5 * MiB,
      1,
    ])
    expect(FakeRequest.mostInFlight).toBe(3)
    const complete = FakeRequest.sent.at(-1)!
    expect(complete.url).toBe('/api/files/chunks/abc123/complete')
    expect(JSON.parse(complete.body as string)).toEqual({
      parts: [1, 2, 3, 4].map((number) => ({
        ETag: `"etag-${number}"`,
        PartNumber: number,
      })),
    })
    expect(progress.at(-1)).toBe(file.size)
  })

  it('show the server’s reason when a part is refused', async () => {
    chunkServer({
      part: (request) =>
        request.respond(
          409,
          {
            error:
              'Storage changed during this upload. Please start a new upload.',
          },
          'Conflict'
        ),
    })
    await expect(uploadFile(sized(10 * MiB + 1), {})).rejects.toThrow(
      'Storage changed during this upload. Please start a new upload.'
    )
  })

  it('name the request size limit when a proxy refuses a part', async () => {
    chunkServer({
      part: (request) =>
        request.respond(413, '<html>Too large</html>', 'Payload Too Large'),
    })
    await expect(uploadFile(sized(10 * MiB + 1), {})).rejects.toThrow(
      REQUEST_TOO_LARGE
    )
  })

  it.each([
    [
      'a refused start',
      { init: (request: FakeRequest) => request.respond(500, '', 'Error') },
      'Failed to initialize upload',
    ],
    [
      'a start without an upload ID',
      {
        init: (request: FakeRequest) =>
          request.respond(200, { data: { fileKey: 'k' } }),
      },
      'Failed to initialize upload',
    ],
    [
      'a part answer without an ETag',
      {
        part: (request: FakeRequest) => request.respond(200, { data: {} }),
      },
      'Failed to parse response',
    ],
    [
      'a refused completion',
      { complete: (request: FakeRequest) => request.respond(500, '', 'Error') },
      'Failed to complete upload',
    ],
    [
      'a completion refused with a reason',
      {
        complete: (request: FakeRequest) =>
          request.respond(400, {
            error: 'Uploaded size does not match the declared file size.',
          }),
      },
      'Uploaded size does not match the declared file size.',
    ],
  ])('report %s', async (_case, answers, message) => {
    chunkServer(answers)
    await expect(uploadFile(sized(10 * MiB + 1), {})).rejects.toThrow(message)
  })
})

describe('profile selection request identity', () => {
  it.each([
    [undefined, undefined],
    [null, 'none'],
    ['profile-1', 'profile-1'],
  ] as const)(
    'preserves %s without serializing inherited settings into either creation request',
    async (profileId, header) => {
      await uploadFile(small(), { profileId })
      await uploadPaste(new File(['hi'], 'paste.txt', { type: 'text/plain' }), {
        profileId,
      })
      const [upload, paste] = FakeRequest.sent
      expect(upload.headers).toEqual(
        header === undefined ? {} : { 'X-Upload-Profile': header }
      )
      expect(paste.headers).toEqual({
        'X-Flare-Paste': 'true',
        ...(header === undefined ? {} : { 'X-Upload-Profile': header }),
      })
      expect(fields(upload)).toEqual([['file', 'file:note.txt']])
      expect(fields(paste)).toEqual([['file', 'file:paste.txt']])
    }
  )
})

describe('pastes', () => {
  const paste = () => new File(['hi'], 'paste.txt', { type: 'text/plain' })

  it('are marked as pastes and send the upload fields', async () => {
    await expect(
      uploadPaste(paste(), {
        profileId: null,
        visibility: 'PRIVATE',
        password: 'correct horse',
      })
    ).resolves.toEqual(uploaded)
    const [request] = FakeRequest.sent
    expect(request.url).toBe('/api/files')
    expect(request.headers).toEqual({
      'X-Flare-Paste': 'true',
      'X-Upload-Profile': 'none',
    })
    expect(fields(request)).toEqual([
      ['file', 'file:paste.txt'],
      ['visibility', 'PRIVATE'],
      ['password', 'correct horse'],
    ])
  })

  it.each([
    [
      500,
      '<html>oops</html>',
      'Could not create your paste. Please try again.',
    ],
    [
      403,
      { error: 'You do not have permission to create pastes.' },
      'You do not have permission to create pastes.',
    ],
    [413, '<html>Too large</html>', REQUEST_TOO_LARGE],
    [
      200,
      { data: { name: 'paste.txt' } },
      'Could not read the upload response.',
    ],
  ])('report a %i answer', async (status, body, message) => {
    FakeRequest.server = (request) => request.respond(status, body)
    await expect(uploadPaste(paste(), {})).rejects.toThrow(message)
  })
})
