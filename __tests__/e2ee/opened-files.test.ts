import { beforeEach, describe, expect, it } from 'vitest'

import type { OpenedFile } from '@/lib/e2ee/client/files'
import {
  forgetOpenedFiles,
  openedFile,
  openedFileState,
  openedFiles,
  openedFilesEpoch,
  rememberOpenedFile,
  rememberUnopenedFile,
} from '@/lib/e2ee/client/opened-files'

const file = (fill: number): OpenedFile => ({
  fileKey: new Uint8Array(32).fill(fill) as OpenedFile['fileKey'],
  headerHash: new Uint8Array(32) as OpenedFile['headerHash'],
  name: 'notes.txt',
  type: 'text/plain',
})

beforeEach(() => forgetOpenedFiles())

describe('the files a page has opened', () => {
  it('keeps a result of work that began after the store was last emptied', () => {
    const startedAt = openedFilesEpoch()
    expect(rememberOpenedFile('a', file(7), startedAt)).toBe(true)
    expect(openedFile('a')?.fileKey).toEqual(new Uint8Array(32).fill(7))
  })

  it('erases a file key that arrives after a lock, and keeps nothing', () => {
    // The work begins while the keys are unlocked.
    const startedAt = openedFilesEpoch()
    // The browser locks before the work ends. The store was empty.
    forgetOpenedFiles()
    const late = file(9)
    expect(rememberOpenedFile('a', late, startedAt)).toBe(false)
    expect(openedFile('a')).toBeUndefined()
    expect(late.fileKey).toEqual(new Uint8Array(32))
    // A failure from before the lock says nothing about the keys of now.
    rememberUnopenedFile('b', startedAt)
    expect(openedFileState('b', openedFiles.version()).failed).toBe(false)
  })

  it('takes new work after the lock', () => {
    forgetOpenedFiles()
    const startedAt = openedFilesEpoch()
    expect(rememberOpenedFile('a', file(3), startedAt)).toBe(true)
    rememberUnopenedFile('b', startedAt)
    expect(openedFileState('b', openedFiles.version()).failed).toBe(true)
    forgetOpenedFiles()
    expect(openedFile('a')).toBeUndefined()
    expect(openedFilesEpoch()).toBeGreaterThan(startedAt)
  })
})
