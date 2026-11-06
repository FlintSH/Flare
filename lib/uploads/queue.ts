/**
 * Upload queues for the browser, and the progress of whichever file is being
 * sent. Each queue sends one batch at a time, one file after another.
 */
import {
  type UploadOptions,
  type UploadResponse,
  partitionBySize,
  uploadFile,
} from './client'

/** A file waiting in an upload queue, or being sent from it. */
export type QueuedFile = {
  readonly key: number
  readonly file: File
  /** An object URL for images, revoked when the file leaves the queue. */
  readonly preview?: string
  /** Bytes sent in the current attempt. */
  readonly uploaded: number
  /** Whole percent of the file sent. */
  readonly progress: number
}

export type UploadBatch = {
  readonly uploaded: readonly UploadResponse[]
  /** Set when a file failed. It and the files after it were not sent. */
  readonly failure?: {
    readonly message: string
    readonly remaining: readonly File[]
  }
}

export type UploadActivity = {
  /** The file being sent, or the last one sent. */
  readonly file: {
    readonly id: number
    readonly name: string
    readonly progress: number
  } | null
  readonly uploading: boolean
}

let activity: UploadActivity = { file: null, uploading: false }
const activityWatchers = new Set<() => void>()
let filesStarted = 0

function setActivity(next: UploadActivity) {
  activity = next
  for (const watch of activityWatchers) watch()
}

/** What the uploads on this page are doing, for the one progress display. */
export const uploadActivity = {
  get: (): UploadActivity => activity,
  subscribe(watch: () => void) {
    activityWatchers.add(watch)
    return () => {
      activityWatchers.delete(watch)
    }
  },
}

const percent = (file: File, uploaded: number) =>
  file.size > 0 ? Math.min(100, Math.round((uploaded / file.size) * 100)) : 100

function batchFailure(sent: number, reason: string) {
  if (!sent) return reason
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  return `${sent} ${sent === 1 ? 'file uploaded' : 'files uploaded'}. ${sentence} Retry the remaining files.`
}

export function createUploadQueue(send = uploadFile) {
  let state: {
    readonly files: readonly QueuedFile[]
    readonly uploading: boolean
  } = { files: [], uploading: false }
  const watchers = new Set<() => void>()
  let keys = 0

  const update = (next: Partial<typeof state>) => {
    state = { ...state, ...next }
    for (const watch of watchers) watch()
  }
  const revoke = (files: readonly QueuedFile[]) => {
    for (const { preview } of files) if (preview) URL.revokeObjectURL(preview)
  }
  const track = (key: number | undefined, uploaded: number) => {
    if (key === undefined) return
    update({
      files: state.files.map((item) =>
        item.key === key
          ? { ...item, uploaded, progress: percent(item.file, uploaded) }
          : item
      ),
    })
  }

  /** Sends files in order and stops at the first failure. */
  async function run(
    files: readonly File[],
    options: UploadOptions,
    queued?: readonly number[]
  ): Promise<UploadBatch | null> {
    if (state.uploading || !files.length) return null
    update({ uploading: true })
    const uploaded: UploadResponse[] = []
    let failure: UploadBatch['failure']
    let id = 0
    try {
      for (const [index, file] of files.entries()) {
        const current = ++filesStarted
        id = current
        setActivity({
          file: { id: current, name: file.name, progress: 0 },
          uploading: true,
        })
        track(queued?.[index], 0)
        uploaded.push(
          await send(file, options, (bytes) => {
            track(queued?.[index], bytes)
            if (activity.file?.id === current)
              setActivity({
                file: {
                  id: current,
                  name: file.name,
                  progress: percent(file, bytes),
                },
                uploading: true,
              })
          })
        )
      }
    } catch (error) {
      failure = {
        message: batchFailure(
          uploaded.length,
          error instanceof Error ? error.message : 'Upload failed'
        ),
        remaining: files.slice(uploaded.length),
      }
    }
    if (activity.file?.id === id) setActivity({ ...activity, uploading: false })
    const sent = new Set(queued?.slice(0, uploaded.length))
    revoke(state.files.filter((item) => sent.has(item.key)))
    update({
      uploading: false,
      files: state.files.filter((item) => !sent.has(item.key)),
    })
    return failure ? { uploaded, failure } : { uploaded }
  }

  return {
    getState: () => state,
    subscribe(watch: () => void) {
      watchers.add(watch)
      return () => {
        watchers.delete(watch)
      }
    },
    /** Queues the files within the server's maximum size; returns the rest. */
    add(files: readonly File[], maxSize: number) {
      const { fitting, tooLarge } = partitionBySize(files, maxSize)
      if (fitting.length)
        update({
          files: [
            ...state.files,
            ...fitting.map((file) => ({
              key: ++keys,
              file,
              preview: file.type.startsWith('image/')
                ? URL.createObjectURL(file)
                : undefined,
              uploaded: 0,
              progress: 0,
            })),
          ],
        })
      return tooLarge
    },
    remove(key: number) {
      const removed = state.files.filter((item) => item.key === key)
      if (!removed.length) return
      revoke(removed)
      update({ files: state.files.filter((item) => item.key !== key) })
    },
    clear() {
      revoke(state.files)
      update({ files: [] })
    },
    /** Sends the queued files. Sent files leave the queue; the rest stay. */
    upload: (options: UploadOptions) =>
      run(
        state.files.map((item) => item.file),
        options,
        state.files.map((item) => item.key)
      ),
    /** Sends these files without queueing them, so nothing waits afterwards. */
    uploadFiles: (files: readonly File[], options: UploadOptions) =>
      run(files, options),
    /** Releases the previews when the queue's owner goes away. */
    dispose() {
      revoke(state.files)
    },
  }
}
