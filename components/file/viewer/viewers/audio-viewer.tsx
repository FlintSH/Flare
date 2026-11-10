import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useMediaRecovery } from '../use-media-recovery'

export function AudioViewer({
  file,
  src,
  recover,
}: {
  file: { name: string; mimeType: string }
  src?: string
  /** Asks for a new `src` after a failure. True if one is on its way. */
  recover?: (code: number | undefined) => boolean
}) {
  const { failed, onError, onLoadedMetadata } = useMediaRecovery(
    src ?? '',
    recover
  )

  if (!src) return <LoadingState message="Loading audio…" />
  if (failed) {
    return <ErrorState error="This audio couldn’t be played in your browser." />
  }

  return (
    // The browser draws the controls, in the theme's colour scheme. The
    // width gives the scrubber room on a card sized to its content.
    <div className="w-[36rem] min-w-0 max-w-full px-6">
      <audio
        src={src}
        controls
        aria-label={`${file.name} audio player`}
        className="block w-full rounded-full focus-visible:outline-offset-[-2px]"
        controlsList="nodownload"
        preload="metadata"
        onError={onError}
        onLoadedMetadata={onLoadedMetadata}
      >
        <source src={src} type={file.mimeType} />
        Your browser does not support audio playback. Download the file to
        listen.
      </audio>
    </div>
  )
}
