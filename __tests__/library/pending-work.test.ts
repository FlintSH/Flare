import { describe, expect, it } from 'vitest'

import {
  type OpenedFile,
  createAccountUnwrapper,
  newEncryptedFile,
  openSealedOcrText,
  openSealedThumbnail,
  sealedOcrTextRecord,
} from '@/lib/e2ee/client/files'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import {
  type PendingDeps,
  type PendingFile,
  processPendingWork,
} from '@/lib/library/pending-work'
import type { OwnedTagView } from '@/lib/tags/owned'

import { clientKeys } from '../auth/e2ee-test-keys'

const keys = clientKeys().accountKeys
const WEBP = Uint8Array.from(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))

const tag = (
  id: string,
  ruleSource: 'filename' | 'ocr',
  ruleText: string
): OwnedTagView => ({ id, name: id, ruleSource, ruleText, fileCount: 0 })
const tags = [
  tag('shots', 'filename', 'screenshot'),
  tag('bills', 'ocr', 'total due'),
]

function encrypted(
  id: string,
  name: string,
  type: string,
  flags: Partial<
    Record<'rulesPending' | 'ocrPending' | 'thumbnailPending', boolean>
  >,
  text?: string
) {
  const created = newEncryptedFile({
    name,
    type,
    accountPublicKey: keys.accountPublicKey,
  })
  const file: PendingFile = {
    id,
    encrypted: true,
    urlPath: `/u/${id}`,
    rulesPending: false,
    ocrPending: false,
    thumbnailPending: false,
    ...flags,
    encryption: created.records,
    sealedOcrText: text ? sealedOcrTextRecord(created, text) : null,
  }
  return { file, created }
}

/** A server in memory: what waits, what was sent, and how often each file failed. */
function store(files: PendingFile[]) {
  const waiting = new Map(files.map((file) => [file.id, file]))
  const attempts = new Map<string, number>()
  const sent = new Map<string, Record<string, unknown>>()
  return {
    sent,
    attempts,
    pending: async (after?: string) => {
      const list = [...waiting.values()]
        .filter((file) => (attempts.get(file.id) ?? 0) < 3)
        .sort((a, b) => a.id.localeCompare(b.id))
      return {
        total: list.length,
        files: list.filter((file) => !after || file.id > after).slice(0, 2),
      }
    },
    work: async (id: string, body: Record<string, unknown>) => {
      if (body.failed) attempts.set(id, (attempts.get(id) ?? 0) + 1)
      else {
        sent.set(id, body)
        waiting.delete(id)
      }
    },
  }
}

async function deps(
  server: ReturnType<typeof store>,
  overrides: Partial<PendingDeps> = {}
): Promise<PendingDeps> {
  const unwrapper = await createAccountUnwrapper(
    {
      accountPrivateKey: keys.accountPrivateKey,
      oldPrivateKeys: [],
    },
    { useNative: false }
  )
  return {
    pending: server.pending,
    work: server.work,
    unwrap: (records) => unwrapper.unwrap(records),
    tags: async () => tags,
    plaintext: async () => new Blob(['pixels']),
    thumbnail: async () => WEBP,
    recognize: async () => ({ text: 'Total due: 40' }),
    sleep: async () => undefined,
    ...overrides,
  }
}

describe('work that waits for the browser of the owner (section 9.7)', () => {
  it('makes the thumbnail, reads the text and applies the rules of a script upload', async () => {
    const { file, created } = encrypted('a', 'Screenshot 1.png', 'image/png', {
      rulesPending: true,
      ocrPending: true,
      thumbnailPending: true,
    })
    const server = store([file])
    const progress: [number, number][] = []
    const result = await processPendingWork(
      await deps(server, {
        report: (done, total) => progress.push([done, total]),
      })
    )
    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(progress.at(-1)).toEqual([1, 1])
    const body = server.sent.get('a')!
    expect(Object.keys(body).sort()).toEqual([
      'ruleTagIds',
      'rulesApplied',
      'sealedOcrText',
      'sealedThumbnail',
    ])
    // The name matches one rule and the new text the other.
    expect(body.ruleTagIds).toEqual(['shots', 'bills'])
    const opened: OpenedFile = { ...created, name: '', type: '' }
    expect(openSealedOcrText(opened, body.sealedOcrText as string)).toBe(
      'Total due: 40'
    )
    expect(
      openSealedThumbnail(
        opened,
        base64urlDecode(body.sealedThumbnail as string)
      )
    ).toEqual(WEBP)
    // Nothing that the server gets is plaintext.
    expect(JSON.stringify(body)).not.toMatch(/Screenshot|Total due/i)
  })

  it('records what cannot be made without downloading the file', async () => {
    const pdf = encrypted('a', 'report.pdf', 'application/pdf', {
      ocrPending: true,
      thumbnailPending: true,
      rulesPending: true,
    })
    const video = encrypted('b', 'clip.mp4', 'video/mp4', {
      thumbnailPending: true,
    })
    const huge = encrypted('c', 'huge.png', 'image/png', {
      thumbnailPending: true,
      ocrPending: true,
    })
    const server = store([pdf.file, video.file, huge.file])
    const fetched: string[] = []
    await processPendingWork(
      await deps(server, {
        plaintext: async (file) => {
          fetched.push(file.id)
          if (file.id === 'c') throw new RangeError('too large')
          return new Blob(['frames'])
        },
      })
    )
    // Not an image or a video: no download, and both flags are settled.
    expect(server.sent.get('a')).toEqual({
      thumbnail: 'none',
      ocr: 'none',
      rulesApplied: true,
      ruleTagIds: [],
    })
    expect(server.sent.get('b')).toMatchObject({
      sealedThumbnail: expect.any(String),
    })
    expect(server.sent.get('c')).toEqual({ thumbnail: 'none', ocr: 'none' })
    expect(fetched.sort()).toEqual(['b', 'c'])
  })

  it('applies sealed rules to plain files, and to stored text without reading the image again', async () => {
    const stored = encrypted(
      'b',
      'scan.png',
      'image/png',
      { rulesPending: true },
      'TOTAL DUE 9'
    )
    const server = store([
      {
        id: 'a',
        encrypted: false,
        name: 'Screenshot from a tool.png',
        mimeType: 'image/png',
        ocrText: 'the total due is 5',
        rulesPending: true,
      },
      stored.file,
    ])
    let recognized = 0
    await processPendingWork(
      await deps(server, {
        recognize: async () => {
          recognized++
          return { text: '' }
        },
      })
    )
    expect(server.sent.get('a')).toEqual({
      rulesApplied: true,
      ruleTagIds: ['shots', 'bills'],
    })
    expect(server.sent.get('b')).toEqual({
      rulesApplied: true,
      ruleTagIds: ['bills'],
    })
    expect(recognized).toBe(0)
  })

  it('leaves the rules while this browser cannot read every tag', async () => {
    const { file } = encrypted('a', 'Screenshot.png', 'image/png', {
      rulesPending: true,
      thumbnailPending: true,
    })
    const server = store([file])
    await processPendingWork(await deps(server, { tags: async () => null }))
    expect(server.sent.get('a')).toEqual({
      sealedThumbnail: expect.any(String),
    })
  })

  it('never loops on a file that fails, backs off, and goes on with the rest', async () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map(
      (id) =>
        encrypted(id, `${id}.png`, 'image/png', { thumbnailPending: true }).file
    )
    const server = store(files)
    const waits: number[] = []
    const calls = new Map<string, number>()
    const run = async () =>
      processPendingWork(
        await deps(server, {
          concurrency: 1,
          sleep: async (ms) => void waits.push(ms),
          thumbnail: async () => WEBP,
          plaintext: async (file) => {
            calls.set(file.id, (calls.get(file.id) ?? 0) + 1)
            if (file.id === 'a' || file.id === 'b')
              throw new Error('storage is down')
            return new Blob(['x'])
          },
        })
      )
    // One run touches each file one time, also the ones that fail.
    expect(await run()).toEqual({ processed: 3, failed: 2 })
    expect([...calls.values()]).toEqual([1, 1, 1, 1, 1])
    expect(waits).toEqual([1_000, 4_000])
    expect([...server.sent.keys()].sort()).toEqual(['c', 'd', 'e'])
    // After three failed runs the server stops listing them.
    expect(await run()).toEqual({ processed: 0, failed: 2 })
    expect(await run()).toEqual({ processed: 0, failed: 2 })
    expect(await run()).toEqual({ processed: 0, failed: 0 })
    expect(calls.get('a')).toBe(3)
  })

  it('pauses between files and stops when the keys go', async () => {
    const files = ['a', 'b', 'c'].map(
      (id) =>
        encrypted(id, `${id}.png`, 'image/png', { thumbnailPending: true }).file
    )
    const server = store(files)
    const controller = new AbortController()
    let release: () => void = () => undefined
    let paused = false
    const work = processPendingWork(
      await deps(server, {
        concurrency: 1,
        signal: controller.signal,
        unpaused: () =>
          paused
            ? new Promise<void>((resolve) => (release = resolve))
            : Promise.resolve(),
        changed: (file) => {
          if (file.id === 'a') paused = true
        },
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect([...server.sent.keys()]).toEqual(['a'])
    paused = false
    controller.abort()
    release()
    await expect(work).rejects.toThrow()
    expect([...server.sent.keys()]).toEqual(['a'])
  })
})
