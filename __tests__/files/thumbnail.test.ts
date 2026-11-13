import { Readable } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  THUMBNAIL_WIDTHS,
  resizedThumbnail,
  thumbnailWidth,
} from '@/lib/files/thumbnail'

const mocks = vi.hoisted(() => ({
  getFileStream: vi.fn(),
  cores: 8,
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getFileStream: mocks.getFileStream }),
}))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  availableParallelism: () => mocks.cores,
}))

const MiB = 1024 ** 2
/** The copies the module keeps for the whole process. */
type Kept = {
  cached: Map<string, Buffer | null>
  bytes: number
  making: Map<string, unknown>
  running: number
  waiting: unknown[]
}
const kept = () =>
  (globalThis as unknown as Record<symbol, Kept>)[
    Symbol.for('flare.files.thumbnails')
  ]

/** What storage holds, by path. */
const stored = new Map<string, Buffer>()
function file(name: string, bytes?: Buffer, size = 1) {
  const path = `uploads/owner/${name}`
  if (bytes) stored.set(path, bytes)
  return { id: name, path, size }
}
const solid = (width: number, height: number, background = '#3366cc') =>
  sharp({ create: { width, height, channels: 3, background } })
const animation = () =>
  Promise.all(
    ['#ff0000', '#00ff00', '#0000ff'].map((background) =>
      solid(64, 48, background).png().toBuffer()
    )
  ).then((frames) => sharp(frames, { join: { animated: true } }))
/** A PNG marked as an animation: an `acTL` chunk ahead of its pixels. */
function asAnimatedPng(png: Buffer) {
  const body = Buffer.alloc(12)
  body.write('acTL', 0, 'latin1')
  // Two frames, played without end.
  body.writeUInt32BE(2, 4)
  const chunk = Buffer.alloc(20)
  chunk.writeUInt32BE(8, 0)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), 16)
  // The signature and the header chunk come first.
  const header = 8 + 25
  return Buffer.concat([png.subarray(0, header), chunk, png.subarray(header)])
}
const describeImage = async (bytes: Buffer | null) => {
  expect(bytes).toBeInstanceOf(Buffer)
  const { format, width, height } = await sharp(bytes!).metadata()
  return { format, width, height }
}

const images = {} as Record<
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'turned'
  | 'gif'
  | 'oneFrameGif'
  | 'animatedWebp'
  | 'animatedPng'
  | 'svg'
  | 'garbage',
  Buffer
>
beforeAll(async () => {
  images.png = await solid(1200, 300).png().toBuffer()
  images.jpeg = await solid(900, 600).jpeg().toBuffer()
  images.webp = await solid(800, 400).webp().toBuffer()
  images.avif = await solid(800, 400).avif().toBuffer()
  // Stored 1200 wide and 600 tall, and shown turned a quarter: 600 by 1200.
  images.turned = await solid(1200, 600)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()
  images.gif = await (await animation()).gif().toBuffer()
  images.oneFrameGif = await solid(300, 200).gif().toBuffer()
  images.animatedWebp = await (await animation()).webp().toBuffer()
  images.animatedPng = asAnimatedPng(images.png)
  images.svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="red"/></svg>'
  )
  images.garbage = Buffer.from('This is a text file named photo.png.')
})

beforeEach(() => {
  const state = kept()
  state.cached.clear()
  state.bytes = 0
  state.making.clear()
  state.running = 0
  state.waiting.length = 0
  stored.clear()
  mocks.cores = 8
  mocks.getFileStream.mockReset().mockImplementation(async (path: string) => {
    const bytes = stored.get(path)
    if (!bytes)
      throw Object.assign(new Error('No such object'), { code: 'ENOENT' })
    return Readable.from([bytes])
  })
})

describe('the width a thumbnail request asks for', () => {
  it.each([
    ['1', 256],
    ['16', 256],
    ['256', 256],
    ['257', 384],
    ['384', 384],
    ['385', 640],
    ['640', 640],
    ['641', 828],
    ['750', 828],
    ['828', 828],
    ['829', 1080],
    ['1080', 1080],
    ['1081', 1920],
    ['1920', 1920],
  ])('answers %s with the first width that is at least as wide', (w, width) => {
    expect(thumbnailWidth(w)).toBe(width)
  })

  it.each(['1921', '2048', '3840', '999999'])(
    'answers %s, wider than every copy, with the widest',
    (w) => {
      expect(thumbnailWidth(w)).toBe(1920)
    }
  )

  it.each([
    '0',
    '-1',
    '1.5',
    'abc',
    '',
    '1000000',
    '12345678',
    '0384',
    ' 384',
    '384 ',
    '+384',
    '1e3',
    '0x100',
    '384px',
    '٣٨٤',
  ])('rejects %j, which is not a positive whole number', (w) => {
    expect(thumbnailWidth(w)).toBeNull()
  })

  it('only ever answers one of the widths copies are made in', () => {
    expect([...THUMBNAIL_WIDTHS]).toEqual([256, 384, 640, 828, 1080, 1920])
    for (let requested = 1; requested <= 4000; requested += 7)
      expect(THUMBNAIL_WIDTHS).toContain(thumbnailWidth(String(requested)))
  })
})

describe('a resized copy of a stored image', () => {
  it('makes a wide PNG a WebP no wider than asked, keeping its shape', async () => {
    const copy = await resizedThumbnail(file('wide.png', images.png), 384)
    expect(await describeImage(copy)).toEqual({
      format: 'webp',
      width: 384,
      height: 96,
    })
    expect(copy!.length).toBeLessThan(images.png.length)
  })

  it.each([
    ['a JPEG', 'jpeg', 256, { width: 256, height: 171 }],
    ['a still WebP', 'webp', 640, { width: 640, height: 320 }],
    ['an AVIF', 'avif', 384, { width: 384, height: 192 }],
  ] as const)('makes %s a WebP', async (_case, image, width, size) => {
    const copy = await resizedThumbnail(file(image, images[image]), width)
    expect(await describeImage(copy)).toEqual({ format: 'webp', ...size })
  })

  it.each([1920, 1080, 828] as const)(
    'never makes a 800 pixel image wider when asked for %i',
    async (width) => {
      const copy = await resizedThumbnail(
        file('small.webp', images.webp),
        width
      )
      expect(await describeImage(copy)).toEqual({
        format: 'webp',
        width: 800,
        height: 400,
      })
    }
  )

  it('turns a photo the way its EXIF orientation shows it before resizing', async () => {
    const copy = await resizedThumbnail(file('turned.jpg', images.turned), 256)
    // The width asked for is the width as shown, and no orientation is left
    // for a browser to apply a second time.
    expect(await describeImage(copy)).toEqual({
      format: 'webp',
      width: 256,
      height: 512,
    })
    expect((await sharp(copy!).metadata()).orientation).toBeUndefined()
    const whole = await resizedThumbnail(file('turned.jpg'), 1920)
    expect(await describeImage(whole)).toMatchObject({
      width: 600,
      height: 1200,
    })
  })

  it.each([
    ['an SVG', 'svg'],
    ['an animated GIF', 'gif'],
    ['a GIF of one frame', 'oneFrameGif'],
    ['an animated WebP', 'animatedWebp'],
    ['bytes that are no image', 'garbage'],
  ] as const)('answers null for %s, and remembers it', async (_case, image) => {
    // Whatever type the uploader claimed, the bytes decide.
    const original = file('photo.png', images[image])
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(mocks.getFileStream).toHaveBeenCalledOnce()
  })

  it('answers null for an animated PNG, which would lose its frames', async () => {
    // The image library reads it as a still PNG, so it could be resized.
    expect(await sharp(images.animatedPng).metadata()).toMatchObject({
      format: 'png',
      width: 1200,
      height: 300,
    })
    const original = file('animation.png', images.animatedPng)
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(mocks.getFileStream).toHaveBeenCalledOnce()
  })

  it('answers null for a file over 32 MiB without reading it', async () => {
    // `size` is in megabytes.
    const large = file('large.png', images.png, 32.01)
    expect(await resizedThumbnail(large, 384)).toBeNull()
    expect(mocks.getFileStream).not.toHaveBeenCalled()
    // A file of exactly the limit is still resized.
    expect(
      await describeImage(
        await resizedThumbnail(file('limit.png', images.png, 32), 384)
      )
    ).toMatchObject({ format: 'webp', width: 384 })
  })

  it('stops reading a file that turns out larger than its recorded size', async () => {
    const chunk = Buffer.alloc(MiB)
    const stream = Readable.from(Array.from({ length: 40 }, () => chunk))
    mocks.getFileStream.mockResolvedValue(stream)
    const longer = file('longer.png', undefined, 1)
    expect(await resizedThumbnail(longer, 384)).toBeNull()
    expect(stream.destroyed).toBe(true)
    // It is remembered, so the next request doesn't read 32 MiB again.
    expect(await resizedThumbnail(longer, 384)).toBeNull()
    expect(mocks.getFileStream).toHaveBeenCalledOnce()
  })

  it('reads storage once, then answers the copy it kept', async () => {
    const original = file('wide.png', images.png)
    const first = await resizedThumbnail(original, 384)
    const second = await resizedThumbnail(original, 384)
    expect(second).toBe(first)
    expect(mocks.getFileStream).toHaveBeenCalledExactlyOnceWith(
      original.path,
      undefined,
      expect.any(AbortSignal)
    )
  })

  it('reads storage once for requests that arrive together', async () => {
    const original = file('wide.png', images.png)
    const copies = await Promise.all([
      resizedThumbnail(original, 384),
      resizedThumbnail(original, 384),
      resizedThumbnail(original, 384),
    ])
    expect(await describeImage(copies[0])).toMatchObject({ width: 384 })
    expect(copies[1]).toBe(copies[0])
    expect(copies[2]).toBe(copies[0])
    expect(mocks.getFileStream).toHaveBeenCalledOnce()
    // Nothing stays marked as being made.
    expect(kept().making.size).toBe(0)
  })

  it('keeps a copy for each width, file and stored path', async () => {
    const original = file('wide.png', images.png)
    const small = await resizedThumbnail(original, 256)
    const medium = await resizedThumbnail(original, 640)
    expect(await describeImage(small)).toMatchObject({ width: 256 })
    expect(await describeImage(medium)).toMatchObject({ width: 640 })
    stored.set('uploads/owner/moved.png', images.jpeg)
    const other = await resizedThumbnail(
      { ...original, path: 'uploads/owner/moved.png' },
      256
    )
    expect(await describeImage(other)).toMatchObject({ height: 171 })
    await resizedThumbnail(file('other.png', images.png), 256)
    expect(mocks.getFileStream).toHaveBeenCalledTimes(4)
  })

  it('answers null when storage fails, and tries again on the next request', async () => {
    const original = file('wide.png', images.png)
    mocks.getFileStream.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(await describeImage(await resizedThumbnail(original, 384))).toEqual({
      format: 'webp',
      width: 384,
      height: 96,
    })
    expect(mocks.getFileStream).toHaveBeenCalledTimes(2)
  })

  it('tries again after a read that failed part of the way through', async () => {
    const original = file('wide.png', images.png)
    mocks.getFileStream.mockResolvedValueOnce(
      Readable.from(
        (async function* () {
          yield images.png.subarray(0, 100)
          throw new Error('Connection reset')
        })()
      )
    )
    expect(await resizedThumbnail(original, 384)).toBeNull()
    expect(
      await describeImage(await resizedThumbnail(original, 384))
    ).toMatchObject({ format: 'webp', width: 384 })
    expect(mocks.getFileStream).toHaveBeenCalledTimes(2)
  })

  it('answers every waiting request when storage fails, and none of them is remembered', async () => {
    const original = file('wide.png', images.png)
    mocks.getFileStream.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect(
      await Promise.all([
        resizedThumbnail(original, 384),
        resizedThumbnail(original, 384),
      ])
    ).toEqual([null, null])
    expect(mocks.getFileStream).toHaveBeenCalledOnce()
    expect(await resizedThumbnail(original, 384)).not.toBeNull()
  })
})

describe('how much resizing runs at once', () => {
  /** Storage that answers each read only when the test lets it. */
  function heldStorage() {
    const release: (() => void)[] = []
    mocks.getFileStream.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          release.push(() => resolve(Readable.from([stored.get(path)!])))
        })
    )
    return release
  }
  const six = () =>
    Array.from({ length: 6 }, (_, index) =>
      resizedThumbnail(file(`photo-${index}.png`, images.png), 256)
    )

  it('resizes three images at a time and starts the next as each one finishes', async () => {
    const release = heldStorage()
    const copies = six()
    await nextTurn()
    expect(mocks.getFileStream).toHaveBeenCalledTimes(3)
    release[0]()
    await copies[0]
    await nextTurn()
    expect(mocks.getFileStream).toHaveBeenCalledTimes(4)
    release[1]()
    release[2]()
    await Promise.all([copies[1], copies[2]])
    await nextTurn()
    expect(mocks.getFileStream).toHaveBeenCalledTimes(6)
    release.slice(3).forEach((next) => next())
    for (const copy of await Promise.all(copies))
      expect(await describeImage(copy)).toMatchObject({ width: 256 })
    expect(kept().running).toBe(0)
    expect(kept().waiting).toHaveLength(0)
  })

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 3],
    [64, 3],
  ])(
    'leaves a thread free: with %i available it resizes %i at a time',
    async (cores, atOnce) => {
      mocks.cores = cores
      const release = heldStorage()
      const copies = six()
      await nextTurn()
      expect(mocks.getFileStream).toHaveBeenCalledTimes(atOnce)
      // Finish them in order; each release lets the next one start.
      for (let index = 0; index < copies.length; index++) {
        while (release.length <= index) await nextTurn()
        release[index]()
        await copies[index]
      }
      expect(kept().running).toBe(0)
    }
  )

  it('frees its place when a resize fails', async () => {
    mocks.cores = 2
    mocks.getFileStream
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockRejectedValueOnce(new Error('Storage unavailable'))
    const copies = await Promise.all([
      resizedThumbnail(file('a.png', images.png), 256),
      resizedThumbnail(file('b.png', images.png), 256),
      resizedThumbnail(file('c.png', images.png), 256),
    ])
    expect(copies.slice(0, 2)).toEqual([null, null])
    expect(await describeImage(copies[2])).toMatchObject({ width: 256 })
    expect(kept().running).toBe(0)
  })
})

describe('requests that stop waiting', () => {
  /** A request the browser gave up on. */
  const gaveUp = () => AbortSignal.abort()

  it('does not read or resize what every requester has given up on, and forgets it', async () => {
    const original = file('scrolled-past.png', images.png)
    expect(await resizedThumbnail(original, 256, gaveUp())).toBeNull()
    expect(mocks.getFileStream).not.toHaveBeenCalled()
    expect(kept().cached.size).toBe(0)

    // The next request for it is answered normally.
    expect(
      await describeImage(await resizedThumbnail(original, 256))
    ).toMatchObject({ format: 'webp', width: 256 })
  })

  /**
   * Fills every resize slot with a read the test releases, so later requests
   * wait. Reads after those three answer at once.
   */
  function busySlots() {
    const release: (() => void)[] = []
    mocks.getFileStream.mockImplementation((path: string) => {
      const answer = () => Readable.from([stored.get(path)!])
      if (release.length === 3) return Promise.resolve(answer())
      return new Promise((resolve) => release.push(() => resolve(answer())))
    })
    const busy = Array.from({ length: 3 }, (_, index) =>
      resizedThumbnail(file(`busy-${index}.png`, images.png), 256)
    )
    return async () => {
      // The three reads start a moment after they are asked for.
      await vi.waitFor(() => expect(release).toHaveLength(3))
      release.forEach((next) => next())
      await Promise.all(busy)
    }
  }

  it('skips a waiting resize once its only requester has given up', async () => {
    const finish = busySlots()
    const leaving = new AbortController()
    const copy = resizedThumbnail(
      file('scrolled-away.png', images.png),
      256,
      leaving.signal
    )
    await nextTurn()
    leaving.abort()
    await finish()
    expect(await copy).toBeNull()
    // Three reads for the busy slots, none for the one nobody waited for.
    expect(mocks.getFileStream).toHaveBeenCalledTimes(3)
    expect(
      kept().cached.has('scrolled-away.png:uploads/owner/scrolled-away.png:256')
    ).toBe(false)
  })

  it('still makes a waiting copy while anyone waits for it', async () => {
    const finish = busySlots()
    const original = file('still-wanted.png', images.png)
    const first = resizedThumbnail(original, 256, gaveUp())
    const second = resizedThumbnail(original, 256, new AbortController().signal)
    await finish()
    expect(await describeImage(await second)).toMatchObject({ width: 256 })
    expect(await first).toBe(await second)
    expect(mocks.getFileStream).toHaveBeenCalledTimes(4)
  })

  it('counts a requester without a signal as always waiting', async () => {
    const finish = busySlots()
    const original = file('no-signal.png', images.png)
    const first = resizedThumbnail(original, 256, gaveUp())
    const second = resizedThumbnail(original, 256)
    await finish()
    expect(await describeImage(await first)).toMatchObject({ width: 256 })
    expect(await second).toBe(await first)
  })

  it('stops reading storage that stalls, answers null and tries again next time', async () => {
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal)
    const original = file('stalled.png', images.png)
    // The headers arrived; the body never does.
    const stalled = new Readable({ read() {} })
    mocks.getFileStream.mockResolvedValueOnce(stalled)
    const copy = resizedThumbnail(original, 256)
    await nextTurn()
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000)
    deadline.abort(new Error('Timed out'))
    expect(await copy).toBeNull()
    expect(stalled.destroyed).toBe(true)
    expect(kept().cached.size).toBe(0)
    expect(kept().running).toBe(0)

    timeout.mockRestore()
    expect(
      await describeImage(await resizedThumbnail(original, 256))
    ).toMatchObject({ width: 256 })
  })

  it('gives the read a deadline storage can honor', async () => {
    await resizedThumbnail(file('deadline.png', images.png), 256)
    const [, , deadline] = mocks.getFileStream.mock.calls[0]
    expect(deadline).toBeInstanceOf(AbortSignal)
    expect(deadline.aborted).toBe(false)
  })

  it('answers null at once when too many resizes already wait', async () => {
    const state = kept()
    // Every slot is busy and the queue is full.
    state.running = 3
    state.waiting.push(...Array.from({ length: 256 }, () => () => {}))
    expect(
      await resizedThumbnail(file('flood.png', images.png), 256)
    ).toBeNull()
    expect(mocks.getFileStream).not.toHaveBeenCalled()
    expect(state.cached.size).toBe(0)
    expect(state.waiting).toHaveLength(256)
  })
})

describe('the copies kept in memory', () => {
  /** Fills the cache to its 64 MiB limit with a copy nothing asks for. */
  function fill() {
    const state = kept()
    const filler = Buffer.allocUnsafe(64 * MiB - state.bytes)
    state.cached.set('filler', filler)
    state.bytes += filler.length
  }

  it('drops the copy used longest ago once they pass 64 MiB', async () => {
    const first = file('first.png', images.png)
    await resizedThumbnail(first, 256)
    fill()
    // The same image again under another name: a copy of the same size.
    await resizedThumbnail(file('second.png', images.png), 256)
    expect(kept().cached.has('filler')).toBe(true)
    expect(kept().bytes).toBeLessThanOrEqual(64 * MiB)
    mocks.getFileStream.mockClear()
    await resizedThumbnail(file('second.png'), 256)
    expect(mocks.getFileStream).not.toHaveBeenCalled()
    // The first copy went, so it is made again.
    await resizedThumbnail(first, 256)
    expect(mocks.getFileStream).toHaveBeenCalledExactlyOnceWith(
      first.path,
      undefined,
      expect.any(AbortSignal)
    )
  })

  it('keeps a copy that was asked for again over one that was not', async () => {
    const first = file('first.png', images.png)
    const copy = await resizedThumbnail(first, 256)
    fill()
    expect(await resizedThumbnail(first, 256)).toBe(copy)
    await resizedThumbnail(file('second.png', images.png), 256)
    expect(kept().cached.has('filler')).toBe(false)
    expect(kept().bytes).toBe(copy!.length * 2)
    mocks.getFileStream.mockClear()
    expect(await resizedThumbnail(first, 256)).toBe(copy)
    expect(mocks.getFileStream).not.toHaveBeenCalled()
  })

  it('counts what it remembers about images it cannot resize', async () => {
    await resizedThumbnail(file('drawing.svg', images.svg), 256)
    expect(kept().cached.size).toBe(1)
    expect(kept().bytes).toBeGreaterThan(0)
  })
})
