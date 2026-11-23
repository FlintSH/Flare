import { TRAY_ACTIVITY, setUploadActivity, uploadActivity } from './activity'
import {
  type UploadOptions,
  type UploadResponse,
  isUploadCancelled,
  partitionBySize,
  stopsEveryUpload,
  uploadFile,
} from './client'
import { createSpeedMeter } from './speed'

/**
 * What a file was uploaded as, shown beside it: the settings in force when it
 * was added, so nothing about it is a surprise afterwards.
 */
export type TrayOutcome = {
  visibility: 'PUBLIC' | 'PRIVATE'
  /** Words for when it expires and what happens, or null when it never does. */
  expires: string | null
  password: boolean
  /** The folder it goes into, or null for none. */
  folder: { id: string; name: string } | null
}

export type TrayStatus = 'held' | 'waiting' | 'sending' | 'done' | 'failed'

export type TrayFile = {
  readonly key: number
  /** Files added while others were still going share their batch. */
  readonly batch: number
  readonly name: string
  readonly size: number
  readonly type: string
  /** An object URL for images, revoked when the file leaves the tray. */
  readonly preview?: string
  readonly status: TrayStatus
  /** Bytes sent in the current attempt. */
  readonly uploaded: number
  /** Whole percent sent. */
  readonly progress: number
  /** Bytes per second while sending; null before it can be measured. */
  readonly speed: number | null
  /** Why it failed, or what it waits for while held. */
  readonly reason?: string
  readonly outcome?: TrayOutcome
  readonly result?: {
    /** Missing from servers that don't send it, which can't delete here. */
    readonly id?: string
    /** The share page. */
    readonly link: string
    readonly name: string
  }
}

type Entry = {
  file: File | null
  options: UploadOptions | null
}

/** Finished files kept in the list; older ones are let go, previews and all. */
const KEPT = 100

export type TrayState = {
  readonly files: readonly TrayFile[]
  /** The newest batch, which Copy and Ctrl/⌘+C mean. */
  readonly batch: number
  /**
   * The failed file that stopped the line, which waits until it is retried
   * or removed; null while the line moves.
   */
  readonly pausedBy: number | null
}

export type TraySettled = {
  readonly uploaded: readonly UploadResponse[]
  readonly failure?: { readonly name: string; readonly reason: string }
}

const percent = (size: number, uploaded: number) =>
  size > 0 ? Math.min(100, Math.round((uploaded / size) * 100)) : 100

let activityIds = TRAY_ACTIVITY

/**
 * The Upload page's files for as long as the tab lives: files start as they
 * land, one at a time, each with the settings it was added with. Leaving the
 * page doesn't stop or forget them; a reload does. Files and links are kept in
 * memory only.
 */
export function createUploadTray(send = uploadFile) {
  let state: TrayState = { files: [], batch: 0, pausedBy: null }
  const entries = new Map<number, Entry>()
  const watchers = new Set<() => void>()
  const settledWatchers = new Set<(settled: TraySettled) => void>()
  let keys = 0
  let running = false
  let current: { key: number; controller: AbortController } | null = null
  let shown = 0
  let owner: string | null = null

  const update = (next: Partial<TrayState>) => {
    state = { ...state, ...next }
    for (const watch of watchers) watch()
  }
  const patch = (key: number, next: Partial<TrayFile>) =>
    update({
      files: state.files.map((item) =>
        item.key === key ? { ...item, ...next } : item
      ),
    })
  const drop = (keys: ReadonlySet<number>) => {
    for (const item of state.files)
      if (keys.has(item.key)) {
        if (item.preview) URL.revokeObjectURL(item.preview)
        entries.delete(item.key)
      }
    update({ files: state.files.filter((item) => !keys.has(item.key)) })
  }
  /** Lets go of the oldest finished files beyond what the list keeps. */
  const trim = () => {
    const finished = state.files.filter(({ status }) => status === 'done')
    if (finished.length > KEPT)
      drop(
        new Set(finished.slice(0, finished.length - KEPT).map(({ key }) => key))
      )
  }
  // A batch is open while any of it waits, is held or is being sent, so
  // files added meanwhile join it. A refused file doesn't keep it open, or a
  // drop minutes later would share its Copy.
  const inFlight = () =>
    state.files.some(
      ({ status, batch }) =>
        batch === state.batch &&
        (status === 'waiting' || status === 'held' || status === 'sending')
    )

  async function run() {
    if (running) return
    running = true
    const uploaded: UploadResponse[] = []
    let failure: TraySettled['failure']
    try {
      for (;;) {
        if (state.pausedBy !== null) break
        const next = state.files.find(({ status }) => status === 'waiting')
        const entry = next && entries.get(next.key)
        if (!next || !entry?.file || !entry.options) break
        const { file, options } = entry
        const controller = new AbortController()
        current = { key: next.key, controller }
        const activity = ++activityIds
        shown = activity
        const measure = createSpeedMeter()
        const show = (bytes: number, speed: number | null) => {
          patch(next.key, {
            status: 'sending',
            uploaded: bytes,
            progress: percent(file.size, bytes),
            speed,
          })
          setUploadActivity({
            file: {
              id: activity,
              name: file.name,
              size: file.size,
              uploaded: bytes,
              progress: bytes ? percent(file.size, bytes) : 0,
              speed,
            },
            uploading: true,
          })
        }
        show(0, measure(0))
        try {
          const response = await send(
            file,
            options,
            (bytes) => {
              if (!controller.signal.aborted) show(bytes, measure(bytes))
            },
            controller.signal
          )
          uploaded.push(response)
          // Nothing of the file or its password is kept once it's sent.
          entry.file = null
          entry.options = null
          patch(next.key, {
            status: 'done',
            uploaded: file.size,
            progress: 100,
            speed: null,
            result: {
              id: response.id,
              link: response.pageUrl || response.url,
              name: response.name,
            },
          })
        } catch (error) {
          if (isUploadCancelled(error)) drop(new Set([next.key]))
          else {
            const reason =
              error instanceof Error ? error.message : 'Upload failed'
            failure = { name: file.name, reason }
            patch(next.key, {
              status: 'failed',
              uploaded: 0,
              progress: 0,
              speed: null,
              reason,
            })
            // A refusal of this one file lets the rest go on.
            if (stopsEveryUpload(error)) update({ pausedBy: next.key })
          }
        } finally {
          current = null
        }
      }
    } finally {
      running = false
      trim()
      const latest = uploadActivity.get()
      if (latest.file?.id === shown)
        setUploadActivity({ ...latest, uploading: false })
    }
    if (uploaded.length || failure)
      for (const watch of settledWatchers)
        watch(failure ? { uploaded, failure } : { uploaded })
  }

  return {
    getState: () => state,
    /**
     * Makes the tray the signed-in account's: another account's files,
     * links and passwords are dropped, and its upload stopped.
     */
    claim(account: string) {
      if (owner === account) return
      if (owner !== null) {
        current?.controller.abort()
        drop(new Set(state.files.map(({ key }) => key)))
        update({ pausedBy: null })
      }
      owner = account
    },
    /** Whether anything is still to be sent, which leaving the tab would stop. */
    busy: () =>
      state.files.some(
        ({ status }) =>
          status === 'waiting' || status === 'sending' || status === 'held'
      ),
    /** Records a change made to a sent file since, such as making it private. */
    amend(key: number, outcome: Partial<TrayOutcome>) {
      const item = state.files.find((file) => file.key === key)
      if (!item?.outcome) return
      patch(key, { outcome: { ...item.outcome, ...outcome } })
    },
    subscribe(watch: () => void) {
      watchers.add(watch)
      return () => {
        watchers.delete(watch)
      }
    },
    /** Hears each run end: what arrived, and the failure that stopped it. */
    onSettled(watch: (settled: TraySettled) => void) {
      settledWatchers.add(watch)
      return () => {
        settledWatchers.delete(watch)
      }
    },
    /**
     * Adds files within the size limit and starts them. Without options they
     * are held, with the reason, until `release` gives them settings. Returns
     * the files over the limit.
     */
    add(
      files: readonly File[],
      maxSize: number,
      settings:
        | {
            options: UploadOptions
            /** Unknown for a drop elsewhere, which the server settles. */
            outcome?: TrayOutcome
          }
        | { held: string }
    ) {
      const { fitting, tooLarge } = partitionBySize(files, maxSize)
      if (!fitting.length) return tooLarge
      const batch = inFlight() ? state.batch : state.batch + 1
      const added = fitting.map((file): TrayFile => {
        const key = ++keys
        entries.set(key, {
          file,
          options: 'options' in settings ? settings.options : null,
        })
        return {
          key,
          batch,
          name: file.name,
          size: file.size,
          type: file.type,
          preview: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
          status: 'held' in settings ? 'held' : 'waiting',
          reason: 'held' in settings ? settings.held : undefined,
          outcome: 'options' in settings ? settings.outcome : undefined,
          uploaded: 0,
          progress: 0,
          speed: null,
        }
      })
      update({ files: [...state.files, ...added], batch })
      void run()
      return tooLarge
    },
    /** Gives held files settings, or a new reason to wait. */
    release(
      settings:
        { options: UploadOptions; outcome: TrayOutcome } | { held: string }
    ) {
      const held = state.files.filter(({ status }) => status === 'held')
      if (!held.length) return
      if ('held' in settings) {
        if (held.every(({ reason }) => reason === settings.held)) return
        update({
          files: state.files.map((item) =>
            item.status === 'held' ? { ...item, reason: settings.held } : item
          ),
        })
        return
      }
      for (const { key } of held) {
        const entry = entries.get(key)
        if (entry) entry.options = settings.options
      }
      update({
        files: state.files.map((item) =>
          item.status === 'held'
            ? {
                ...item,
                status: 'waiting',
                reason: undefined,
                outcome: settings.outcome,
              }
            : item
        ),
      })
      void run()
    },
    /** Stops a file that is waiting or being sent, and forgets it. */
    cancel(key: number) {
      if (current?.key === key) current.controller.abort()
      else drop(new Set([key]))
    },
    /** Sends a failed file again, and the files behind it. */
    retry(key: number) {
      const item = state.files.find((file) => file.key === key)
      if (item?.status !== 'failed') return
      update({
        pausedBy: state.pausedBy === key ? null : state.pausedBy,
        files: state.files.map((file) =>
          file.key === key
            ? { ...file, status: 'waiting', reason: undefined }
            : file
        ),
      })
      void run()
    },
    /** Forgets a file that isn't being sent; a removed failure frees the line. */
    remove(key: number) {
      const item = state.files.find((file) => file.key === key)
      if (!item || item.status === 'sending') return
      drop(new Set([key]))
      if (state.pausedBy === key) {
        update({ pausedBy: null })
        void run()
      }
    },
    /** Forgets a finished file deleted elsewhere (its sheet), by its id. */
    forgetFile(fileId: string) {
      const gone = state.files
        .filter((file) => file.status === 'done' && file.result?.id === fileId)
        .map(({ key }) => key)
      if (gone.length) drop(new Set(gone))
    },
    /** Forgets every finished file; anything still going stays. */
    clear() {
      drop(
        new Set(
          state.files
            .filter(({ status }) => status === 'done' || status === 'failed')
            .map(({ key }) => key)
        )
      )
      if (state.pausedBy !== null) update({ pausedBy: null })
      void run()
    },
  }
}

export type UploadTray = ReturnType<typeof createUploadTray>

let tray: UploadTray | null = null

/** This tab's tray, made on first use. */
export function uploadTray() {
  tray ??= createUploadTray()
  return tray
}
