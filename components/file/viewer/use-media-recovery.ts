import { useRef, useState } from 'react'

/**
 * What a media element does when its source fails. A source that can be
 * given again, such as the local address of an encrypted file whose service
 * worker the browser stopped (docs/e2ee-spec.md, section 12.2), gets a new
 * address from `recover` and playback goes on from where it was. Each other
 * failure shows the player's error.
 */
export function useMediaRecovery(src: string, recover?: () => boolean) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const resume = useRef<{ time: number; playing: boolean } | null>(null)
  return {
    failed: failedUrl === src,
    onError(event: React.SyntheticEvent<HTMLMediaElement>) {
      const element = event.currentTarget
      if (recover?.()) {
        resume.current = {
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
      resume.current = null
      const element = event.currentTarget
      if (pending.time > 0) element.currentTime = pending.time
      if (pending.playing) void element.play().catch(() => undefined)
    },
  }
}
