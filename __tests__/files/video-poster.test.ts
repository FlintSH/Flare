import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const storage = vi.hoisted(() => ({
  dir: '',
  localPath: vi.fn(),
  getPublicUrl: vi.fn(),
}))
// The saved frames table, kept in memory.
const frames = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    videoFrame: {
      findUnique: vi.fn(
        async ({ where }: { where: { fileId: string } }) =>
          frames.rows.get(where.fileId) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { fileId: string }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const row = frames.rows.has(where.fileId) ? update : create
          frames.rows.set(where.fileId, { fileId: where.fileId, ...row })
          return row
        }
      ),
    },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    kind: 'local',
    localPath: storage.localPath,
    getPublicUrl: storage.getPublicUrl,
  }),
}))

const { ffmpegCommand, readyVideoPoster, videoPoster } =
  await import('@/lib/files/video-poster')

/** Forgets what this process made, as a restart does. */
function restart() {
  const state = (
    globalThis as unknown as Record<
      symbol,
      {
        cached: Map<string, unknown>
        bytes: number
        failed: Map<string, number>
      }
    >
  )[Symbol.for('flare.files.videoPosters')]
  state.cached.clear()
  state.bytes = 0
  state.failed.clear()
}

// GitHub's Ubuntu runners and Flare's Docker image have ffmpeg; a machine
// without it skips the checks that need one.
const ffmpeg = spawnSync(ffmpegCommand(), ['-version']).status === 0

function encode(name: string, args: string[]) {
  const result = spawnSync(ffmpegCommand(), [
    ...['-loglevel', 'error', '-y'],
    ...args,
    join(storage.dir, name),
  ])
  if (result.status !== 0) throw new Error(String(result.stderr))
}

let id = 0
const poster = (name: string) =>
  videoPoster({ id: `video-${++id}`, path: name })

beforeAll(() => {
  storage.dir = mkdtempSync(join(tmpdir(), 'flare-video-poster-'))
  if (!ffmpeg) return
  // Landscape H.264 with its index at the end, as phones write it.
  encode('landscape.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  ])
  encode('portrait.webm', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=2'],
    ...['-c:v', 'libvpx-vp9', '-b:v', '200k'],
  ])
  // Shorter than the second Flare skips ahead to.
  encode('short.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=0.3'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  ])
  // Anamorphic: stored 720 wide, shown 16:9 through its pixel shape.
  encode('anamorphic.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=720x576:rate=25:duration=2'],
    ...['-vf', 'setsar=64/45', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  ])
  // A phone's portrait video: stored landscape, turned by its metadata.
  encode('stored-landscape.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  ])
  encode('phone.mp4', [
    ...['-display_rotation', '90'],
    ...['-i', join(storage.dir, 'stored-landscape.mp4'), '-c', 'copy'],
  ])
  // Taller than the largest frame Flare keeps.
  encode('tall.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=size=360x1920:rate=30:duration=2'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  ])
  encode('silent.m4a', [
    ...['-f', 'lavfi', '-i', 'sine=duration=2'],
    ...['-c:a', 'aac'],
  ])
})
afterAll(() => rmSync(storage.dir, { recursive: true, force: true }))
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  storage.localPath.mockImplementation((path: string) =>
    join(storage.dir, path)
  )
})

describe.skipIf(!ffmpeg)('a frame from a stored video', () => {
  it('makes a WebP frame no wider than 1280, in the video’s shape', async () => {
    const frame = await poster('landscape.mp4')
    expect(frame).toMatchObject({ width: 1280, height: 720 })
    if (!frame || frame === 'busy') throw new Error('No frame')
    expect(await sharp(frame.image).metadata()).toMatchObject({
      format: 'webp',
      width: 1280,
      height: 720,
    })
  })

  it('keeps a portrait video upright and small', async () => {
    expect(await poster('portrait.webm')).toMatchObject({
      width: 360,
      height: 640,
    })
  })

  it('turns a phone video the way its player does', async () => {
    expect(await poster('phone.mp4')).toMatchObject({ width: 360, height: 640 })
  })

  it('keeps a tall video within 1280 pixels both ways', async () => {
    expect(await poster('tall.mp4')).toMatchObject({ width: 240, height: 1280 })
  })

  it('takes the first frame of a video shorter than a second', async () => {
    expect(await poster('short.mp4')).toMatchObject({ width: 320, height: 240 })
  })

  it('shows non-square pixels at the shape the video plays in', async () => {
    // Stored 720 × 576 with 64:45 pixels, so it plays as 1024 × 576.
    expect(await poster('anamorphic.mp4')).toMatchObject({
      width: 1024,
      height: 576,
    })
  })

  it('makes a frame once and answers again from memory', async () => {
    const file = { id: 'kept', path: 'landscape.mp4' }
    const [first, second] = await Promise.all([
      videoPoster(file),
      videoPoster(file),
    ])
    expect(second).toBe(first)
    expect(await videoPoster(file)).toBe(first)
    expect(storage.localPath).toHaveBeenCalledOnce()
  })

  it('has nothing for a file without a picture', async () => {
    expect(await poster('silent.m4a')).toBeNull()
  })

  it('refuses a playlist that names other files', async () => {
    writeFileSync(
      join(storage.dir, 'playlist.mp4'),
      `#EXTM3U\n#EXTINF:3,\n${join(storage.dir, 'landscape.mp4')}\n#EXT-X-ENDLIST\n`
    )
    expect(await poster('playlist.mp4')).toBeNull()
  })

  it('does not try a failed video again right away', async () => {
    const file = { id: 'broken', path: 'missing.mp4' }
    expect(await videoPoster(file)).toBeNull()
    expect(await videoPoster(file)).toBeNull()
    expect(storage.localPath).toHaveBeenCalledOnce()
  })
})

describe('without ffmpeg', () => {
  it('has no frame to show, and says so once', async () => {
    vi.stubEnv('FLARE_FFMPEG_PATH', join(storage.dir, 'no-such-ffmpeg'))
    writeFileSync(join(storage.dir, 'any.mp4'), 'not a video')
    expect(await poster('any.mp4')).toBeNull()
    // Installing ffmpeg later brings frames back, so nothing is saved.
    expect(frames.rows.has(`video-${id}`)).toBe(false)
  })
})

describe('making frames under load', () => {
  // A stand-in ffmpeg that logs each run, waits a moment and prints a PNG.
  function fakeFfmpeg(seconds: number) {
    const png = join(storage.dir, 'frame.png')
    const runs = join(storage.dir, `runs-${++id}.log`)
    const program = join(storage.dir, `ffmpeg-${id}.sh`)
    writeFileSync(runs, '')
    writeFileSync(
      program,
      `#!/bin/sh\necho run >> '${runs}'\nsleep ${seconds}\ncat '${png}'\n`
    )
    chmodSync(program, 0o755)
    vi.stubEnv('FLARE_FFMPEG_PATH', program)
    return () => readFileSync(runs, 'utf8').split('\n').filter(Boolean).length
  }

  beforeAll(async () => {
    await sharp({
      create: { width: 64, height: 36, channels: 3, background: '#336699' },
    })
      .png()
      .toFile(join(storage.dir, 'frame.png'))
  })

  it('answers busy past the queue, and still makes every frame it took', async () => {
    const runs = fakeFfmpeg(0.02)
    const files = Array.from({ length: 67 }, (_, index) => ({
      id: `load-${id}-${index}`,
      path: 'any.mp4',
    }))
    const answers = await Promise.all(files.map((file) => videoPoster(file)))
    // Two run, 64 wait, and the last is turned away without being tried.
    expect(answers.filter((answer) => answer === 'busy')).toHaveLength(1)
    expect(answers.at(-1)).toBe('busy')
    expect(runs()).toBe(66)
    // Busy isn't a failure: the same video is made when asked again.
    expect(await videoPoster(files.at(-1)!)).toMatchObject({ width: 64 })
  })

  it('makes no frame for a request that left while it waited', async () => {
    const runs = fakeFfmpeg(0.3)
    const running = [0, 1].map((index) =>
      videoPoster({ id: `slow-${id}-${index}`, path: 'any.mp4' })
    )
    const controller = new AbortController()
    const waiting = videoPoster(
      { id: `gone-${id}`, path: 'any.mp4' },
      controller.signal
    )
    controller.abort()
    expect(await waiting).toBe('busy')
    await Promise.all(running)
    expect(runs()).toBe(2)
  })

  it('turns away a request cancelled before it asked', async () => {
    const runs = fakeFfmpeg(0.3)
    const running = [0, 1].map((index) =>
      videoPoster({ id: `full-${id}-${index}`, path: 'any.mp4' })
    )
    const controller = new AbortController()
    controller.abort()
    // At once, not after the running frames free a slot.
    const answer = await Promise.race([
      videoPoster({ id: `early-${id}`, path: 'any.mp4' }, controller.signal),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 100)),
    ])
    expect(answer).toBe('busy')
    await Promise.all(running)
    expect(runs()).toBe(2)
  })

  it('keeps waiting while anyone who asked for the frame still waits', async () => {
    fakeFfmpeg(0.2)
    const running = [0, 1].map((index) =>
      videoPoster({ id: `busy-${id}-${index}`, path: 'any.mp4' })
    )
    const file = { id: `shared-${id}`, path: 'any.mp4' }
    const left = new AbortController()
    const first = videoPoster(file, left.signal)
    const second = videoPoster(file, new AbortController().signal)
    left.abort()
    expect(await second).toMatchObject({ width: 64 })
    expect(await first).toMatchObject({ width: 64 })
    await Promise.all(running)
  })
})

describe.skipIf(!ffmpeg)('frames saved with their file', () => {
  it('makes a frame once, and reads it back after a restart', async () => {
    const file = { id: `saved-${++id}`, path: 'landscape.mp4' }
    const first = await videoPoster(file)
    expect(frames.rows.get(file.id)).toMatchObject({
      path: 'landscape.mp4',
      width: 1280,
      height: 720,
    })
    restart()
    storage.localPath.mockClear()
    const again = await videoPoster(file)
    expect(again).toMatchObject({ width: 1280, height: 720 })
    expect(storage.localPath).not.toHaveBeenCalled()
    if (!first || first === 'busy' || !again || again === 'busy')
      throw new Error('No frame')
    expect(Buffer.compare(again.image, first.image)).toBe(0)
  })

  it('makes a new frame when the file has a different path', async () => {
    const file = { id: `moved-${++id}`, path: 'landscape.mp4' }
    await videoPoster(file)
    restart()
    expect(await videoPoster({ ...file, path: 'portrait.webm' })).toMatchObject(
      { width: 360, height: 640 }
    )
  })

  it('remembers a video ffmpeg got no frame from, for a day', async () => {
    const file = { id: `silent-${++id}`, path: 'silent.m4a' }
    expect(await videoPoster(file)).toBeNull()
    expect(frames.rows.get(file.id)).toMatchObject({ image: null })
    restart()
    storage.localPath.mockClear()
    expect(await videoPoster(file)).toBeNull()
    expect(storage.localPath).not.toHaveBeenCalled()

    // A day later it is tried again.
    frames.rows.get(file.id)!.createdAt = new Date(Date.now() - 25 * 3600_000)
    restart()
    expect(await videoPoster(file)).toBeNull()
    expect(storage.localPath).toHaveBeenCalledOnce()
  })

  it('counts a frame once when two requests find it saved together', async () => {
    const file = { id: `twice-${++id}`, path: 'landscape.mp4' }
    const made = await videoPoster(file)
    if (!made || made === 'busy') throw new Error('No frame')
    restart()
    await Promise.all([readyVideoPoster(file), readyVideoPoster(file)])
    const state = (globalThis as unknown as Record<symbol, { bytes: number }>)[
      Symbol.for('flare.files.videoPosters')
    ]
    expect(state.bytes).toBe(made.image.length)
  })

  it('gives the share page only a frame that is ready, and starts one', async () => {
    const file = { id: `page-${++id}`, path: 'landscape.mp4' }
    const started = Date.now()
    expect(await readyVideoPoster(file)).toBeNull()
    // It answered without waiting for ffmpeg.
    expect(Date.now() - started).toBeLessThan(100)
    // The frame it started arrives for the page's own request.
    expect(await videoPoster(file)).toMatchObject({ width: 1280 })
    expect(storage.localPath).toHaveBeenCalledOnce()
    expect(await readyVideoPoster(file)).toMatchObject({ width: 1280 })
    restart()
    expect(await readyVideoPoster(file)).toMatchObject({ width: 1280 })
  })
})
