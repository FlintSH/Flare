/**
 * What the uploads on this page are doing, for the one progress display. It
 * is kept apart from the upload queue so that display, which every page
 * carries, doesn't bring the uploader with it.
 */
export type UploadActivity = {
  /** The file being sent, or the last one sent. */
  readonly file: {
    readonly id: number
    readonly name: string
    readonly size: number
    /** Bytes sent so far. */
    readonly uploaded: number
    readonly progress: number
    /** Bytes per second; null before it can be measured. */
    readonly speed: number | null
  } | null
  readonly uploading: boolean
}

let activity: UploadActivity = { file: null, uploading: false }
const watchers = new Set<() => void>()

export const uploadActivity = {
  get: (): UploadActivity => activity,
  subscribe(watch: () => void) {
    watchers.add(watch)
    return () => {
      watchers.delete(watch)
    }
  },
}

/** For the upload queue, which is what reports activity. */
export function setUploadActivity(next: UploadActivity) {
  activity = next
  for (const watch of watchers) watch()
}

/**
 * Where the Upload page's file numbers start, apart from the drop zone's, so
 * the progress card never mistakes one uploader's file for the other's.
 */
export const TRAY_ACTIVITY = 1_000_000

/** Whether the progress card's file is the Upload page's, which shows its own. */
export const isTrayActivity = (id: number) => id > TRAY_ACTIVITY
