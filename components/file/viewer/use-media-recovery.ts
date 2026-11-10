import { useRef, useState } from 'react'

/**
 * How long after the metadata of a new address the player is moved back to
 * where it was. Not in the same moment: a seek that Chromium gets at the
 * instant the metadata arrives is sometimes answered by reading the file
 * from its start to the target (about one time in five with a service
 * worker address, never 250 ms later).
 */
const RESUME_DELAY_MS = 400

/**
 * What a media element does when its source fails. A source that can be
 * given again, such as the local address of an encrypted file whose service
 * worker the browser stopped (docs/e2ee-spec.md, section 12.2), gets a new
 * address from `recover` and playback goes on from where it was. Each other
 * failure shows the player's error.
 */
export function useMediaRecovery(
  src: string,
  /** Gets the element's error code. True if a new `src` is on its way. */
  recover?: (code: number | undefined) => boolean
) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const resume = useRef<{ time: number; playing: boolean } | null>(null)
  return {
    failed: failedUrl === src,
    onError(event: React.SyntheticEvent<HTMLMediaElement>) {
      const element = event.currentTarget
      if (recover?.(element.error?.code)) {
        // A position that the failed address never got back to is kept.
        resume.current ??= {
          time: element.currentTime,
          playing: !element.paused && !element.ended,
        }
        return
      }
      setFailedUrl(src)
    },
    onLoadedMetadata(event: React.SyntheticEvent<HTMLMediaElement>) {
      const pending = resume.current
      if (!pending) return
      const element = event.currentTarget
      const address = element.currentSrc
      window.setTimeout(() => {
        // The address failed again meanwhile: its successor resumes.
        if (resume.current !== pending || element.currentSrc !== address) return
        resume.current = null
        if (pending.time > 0) element.currentTime = pending.time
        if (pending.playing) void element.play().catch(() => undefined)
      }, RESUME_DELAY_MS)
    },
  }
}
