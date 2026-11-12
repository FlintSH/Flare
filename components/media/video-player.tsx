'use client'

import { useEffect, useRef, useState } from 'react'

import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import { MuteButton, SpeedButton, mediaButtonClassName } from './media-buttons'
import { MediaSlider } from './media-slider'
import {
  SEEK_STEP,
  formatMediaTime,
  mediaKeyAction,
  mediaKeyTarget,
  spokenMediaTime,
} from './media-utils'
import { useMedia, useMediaProgress } from './use-media'

/** How long the controls stay up over a playing video once the pointer rests. */
const CONTROLS_LINGER_MS = 2500

/** Safari on iPhone plays full screen only in its own player. */
type NativeFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
}

/** The frame held for a video until it reports its own. */
const DEFAULT_RATIO = 16 / 9

interface VideoPlayerProps {
  src: string
  /** Names the player to screen readers. */
  name: string
  /** Called when the browser can't play the file. */
  onError?: () => void
  /** Sizes the player, such as the tallest it may grow. */
  className?: string
}

/**
 * Flare's video player: the browser decodes and streams the file, and Flare
 * draws the controls, so they look the same in every browser and theme. The
 * controls sit over the picture and step aside while it plays.
 */
export function VideoPlayer({
  src,
  name,
  onError,
  className,
}: VideoPlayerProps) {
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const media = useMedia(video)
  const { state } = media

  // The player keeps the usual 16:9 frame until the video reports its own
  // shape, so a 16:9 video starts without moving the page.
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [fullscreen, setFullscreen] = useState(false)
  const [inPicture, setInPicture] = useState(false)
  const [support, setSupport] = useState({ fullscreen: false, picture: false })
  // Shown until the pointer has rested, while a slider is dragged, and
  // whenever the video isn't playing.
  const [active, setActive] = useState(true)
  const [dragging, setDragging] = useState(false)
  const controlsShown = active || dragging || !state.playing
  // What the press that became a click was: a mouse plays and pauses, a
  // touch brings the controls up or sends them away.
  const press = useRef({ pointer: 'mouse', controlsShown: true })
  // When the controls were last asked for. The timer below reads it, so a
  // pointer that keeps moving holds them up without a render per movement.
  const lastWake = useRef(0)

  useEffect(() => {
    const element = video.current as NativeFullscreenVideo | null
    setSupport({
      fullscreen:
        document.fullscreenEnabled ||
        typeof element?.webkitEnterFullscreen === 'function',
      picture:
        document.pictureInPictureEnabled === true &&
        element?.disablePictureInPicture !== true,
    })
    const onFullscreen = () =>
      setFullscreen(document.fullscreenElement === frame.current)
    const onPicture = () =>
      setInPicture(document.pictureInPictureElement === element)
    document.addEventListener('fullscreenchange', onFullscreen)
    element?.addEventListener('enterpictureinpicture', onPicture)
    element?.addEventListener('leavepictureinpicture', onPicture)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      element?.removeEventListener('enterpictureinpicture', onPicture)
      element?.removeEventListener('leavepictureinpicture', onPicture)
    }
  }, [])

  // The pointer resting over a playing video lets the controls go. The wait
  // counts from the last movement, key or tap, not from the first.
  useEffect(() => {
    if (!active || !state.playing) return
    const started = performance.now()
    let timer = 0
    const rest = () => {
      const since = Math.max(lastWake.current, started)
      const left = CONTROLS_LINGER_MS - (performance.now() - since)
      if (left <= 0) setActive(false)
      else timer = window.setTimeout(rest, left)
    }
    timer = window.setTimeout(rest, CONTROLS_LINGER_MS)
    return () => window.clearTimeout(timer)
  }, [active, state.playing])

  const wake = () => {
    lastWake.current = performance.now()
    setActive(true)
  }

  const toggleFullscreen = () => {
    const element = frame.current
    if (!element) return
    if (document.fullscreenElement === element)
      return void document.exitFullscreen().catch(() => {})
    if (document.fullscreenEnabled)
      return void element.requestFullscreen().catch(() => {})
    ;(video.current as NativeFullscreenVideo | null)?.webkitEnterFullscreen?.()
  }

  const togglePicture = () => {
    if (document.pictureInPictureElement)
      return void document.exitPictureInPicture().catch(() => {})
    void video.current?.requestPictureInPicture().catch(() => {})
  }

  const CenterIcon = state.ended ? RotateCcw : state.playing ? Pause : Play
  const playLabel = state.ended ? 'Replay' : state.playing ? 'Pause' : 'Play'

  return (
    <div
      ref={frame}
      role="group"
      aria-label={`${name} video player`}
      tabIndex={0}
      data-flare-player="video"
      className={cn(
        'group/player relative isolate mx-auto w-full overflow-hidden bg-black text-white outline-none [container-type:inline-size] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        // Hidden with the controls, so nothing sits over a playing video.
        !controlsShown && 'cursor-none',
        fullscreen ? 'h-full' : className
      )}
      style={fullscreen ? undefined : { aspectRatio: ratio }}
      onPointerMove={wake}
      onPointerDown={(event) => {
        press.current = { pointer: event.pointerType, controlsShown }
        wake()
      }}
      onFocus={wake}
      // A finger leaves with every tap; only a mouse moving away hides them.
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setActive(false)
      }}
      onKeyDown={(event) => {
        wake()
        const action = mediaKeyAction(event, {
          video: true,
          on: mediaKeyTarget(event.target),
        })
        if (!action) return
        event.preventDefault()
        if (action.type === 'fullscreen') toggleFullscreen()
        else media.perform(action)
      }}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        // A mouse click plays and pauses. A tap brings the controls up,
        // where the play button is, and a second tap sends them away.
        onClick={() => {
          if (press.current.pointer === 'mouse') media.toggle()
          else if (press.current.controlsShown && state.playing)
            setActive(false)
        }}
        onDoubleClick={() => {
          if (press.current.pointer === 'mouse') toggleFullscreen()
        }}
        onLoadedMetadata={({ currentTarget: element }) => {
          if (element.videoWidth && element.videoHeight)
            setRatio(element.videoWidth / element.videoHeight)
        }}
        onError={onError}
      />

      {/* The big button: Play before the first play, and whatever comes next
          while the controls are up. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {state.waiting ? (
          <span
            role="status"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 [@container(min-width:30rem)]:h-16 [@container(min-width:30rem)]:w-16"
          >
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading video…</span>
          </span>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={media.toggle}
            className={cn(
              'pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/55 shadow-lg backdrop-blur-sm transition-[opacity,transform,background-color] duration-200 hover:bg-black/70 [@container(min-width:30rem)]:h-16 [@container(min-width:30rem)]:w-16',
              // Out of the way of a playing picture. A touch screen keeps
              // it while the controls are up, as its way to pause.
              state.playing &&
                (controlsShown
                  ? 'pointer-events-none opacity-0 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100'
                  : 'pointer-events-none opacity-0')
            )}
          >
            <CenterIcon
              className={cn(
                'h-6 w-6 fill-current',
                CenterIcon === Play && 'translate-x-0.5',
                CenterIcon === RotateCcw && 'fill-none'
              )}
            />
          </button>
        )}
      </div>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-1.5 pt-10 transition-opacity duration-200 sm:px-3 sm:pb-2',
          // A control focused from the keyboard keeps them up, so the focus
          // ring is never hidden. One that was clicked doesn't: the button
          // keeps focus after a click, and the controls would never leave.
          !controlsShown &&
            'pointer-events-none opacity-0 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100'
        )}
      >
        <Timeline
          video={video}
          playing={state.playing}
          duration={state.duration}
          onSeek={media.seekTo}
          onDragChange={setDragging}
        />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={media.toggle}
            aria-label={playLabel}
            title={playLabel}
            className={mediaButtonClassName('media')}
          >
            {state.ended ? (
              <RotateCcw className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : state.playing ? (
              <Pause
                className="h-[18px] w-[18px] fill-current"
                aria-hidden="true"
              />
            ) : (
              <Play
                className="h-[18px] w-[18px] fill-current"
                aria-hidden="true"
              />
            )}
          </button>
          <MuteButton media={media} tone="media" />
          {/* A phone sets the volume with its own buttons. */}
          <MediaSlider
            label="Volume"
            tone="media"
            value={state.muted ? 0 : state.volume}
            max={1}
            step={0.05}
            valueText={`${Math.round((state.muted ? 0 : state.volume) * 100)}%`}
            onChange={media.setVolume}
            onDragChange={setDragging}
            className="mx-1 hidden w-16 shrink-0 [@container(min-width:30rem)]:[@media(pointer:fine)]:flex"
          />
          <TimeLabel
            video={video}
            playing={state.playing}
            duration={state.duration}
          />
          <span className="flex-1" />
          <SpeedButton media={media} tone="media" />
          {support.picture && (
            <button
              type="button"
              onClick={togglePicture}
              aria-label={
                inPicture ? 'Leave picture-in-picture' : 'Picture-in-picture'
              }
              aria-pressed={inPicture}
              title={
                inPicture ? 'Leave picture-in-picture' : 'Picture-in-picture'
              }
              className={cn(
                mediaButtonClassName('media'),
                'hidden [@container(min-width:26rem)]:inline-flex'
              )}
            >
              <PictureInPicture2
                className="h-[18px] w-[18px]"
                aria-hidden="true"
              />
            </button>
          )}
          {support.fullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
              className={mediaButtonClassName('media')}
            >
              {fullscreen ? (
                <Minimize className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <Maximize className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Timeline({
  video,
  playing,
  duration,
  onSeek,
  onDragChange,
}: {
  video: React.RefObject<HTMLVideoElement | null>
  playing: boolean
  duration: number
  onSeek: (seconds: number) => void
  onDragChange: (dragging: boolean) => void
}) {
  const { time, buffered } = useMediaProgress(video, playing)
  return (
    <MediaSlider
      label="Seek"
      tone="media"
      value={time}
      max={duration}
      step={SEEK_STEP}
      secondary={buffered}
      valueText={`${spokenMediaTime(time)} of ${spokenMediaTime(duration)}`}
      hint={(seconds) => formatMediaTime(seconds, duration)}
      onChange={onSeek}
      onDragChange={onDragChange}
      disabled={duration === 0}
      className="mx-1.5"
    />
  )
}

function TimeLabel({
  video,
  playing,
  duration,
}: {
  video: React.RefObject<HTMLVideoElement | null>
  playing: boolean
  duration: number
}) {
  const { time } = useMediaProgress(video, playing)
  return (
    <span className="ml-1.5 whitespace-nowrap text-xs font-medium tabular-nums text-white/90">
      {formatMediaTime(time, duration)}
      <span className="text-white/60">
        {' / '}
        {duration ? formatMediaTime(duration) : '–:––'}
      </span>
    </span>
  )
}
