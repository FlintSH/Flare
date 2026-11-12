'use client'

import { useRef } from 'react'

import { FastForward, Loader2, Pause, Play, Rewind } from 'lucide-react'

import { cn } from '@/lib/utils'

import { MuteButton, SpeedButton, mediaButtonClassName } from './media-buttons'
import { MediaSlider } from './media-slider'
import {
  SEEK_JUMP,
  SEEK_STEP,
  formatMediaTime,
  mediaKeyAction,
  mediaKeyTarget,
  spokenMediaTime,
} from './media-utils'
import { useMedia, useMediaProgress } from './use-media'

interface AudioPlayerProps {
  /** Absent until the file's address is known; the player waits, idle. */
  src?: string
  /** Names the player to screen readers. */
  name: string
  /** Called when the browser can't play the file. */
  onError?: () => void
  className?: string
}

/**
 * Flare's audio player, in the theme's colours: a timeline with the position
 * and the length under it, then speed, skip, play and volume. Every row has a
 * fixed height, so the player is the same size before and after the file
 * loads.
 */
export function AudioPlayer({
  src,
  name,
  onError,
  className,
}: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null)
  const media = useMedia(audio)
  const { state } = media
  const idle = !src
  const playLabel = state.playing ? 'Pause' : 'Play'

  return (
    <div
      role="group"
      aria-label={`${name} audio player`}
      data-flare-player="audio"
      // Focusable like the video player, so a click anywhere on it, or a
      // drag of a slider, leaves the keys with the player.
      tabIndex={idle ? undefined : 0}
      className={cn(
        'w-full rounded-md outline-none [container-type:inline-size] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
        className
      )}
      onKeyDown={(event) => {
        const action = mediaKeyAction(event, {
          video: false,
          on: mediaKeyTarget(event.target),
        })
        if (!action) return
        event.preventDefault()
        media.perform(action)
      }}
    >
      {/* Without controls of its own the element takes no space. */}
      <audio ref={audio} src={src} preload="metadata" onError={onError} />
      <Timeline audio={audio} media={media} disabled={idle} />
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex justify-start">
          <SpeedButton media={media} tone="surface" disabled={idle} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => media.seekBy(-SEEK_JUMP)}
            disabled={idle}
            aria-label={`Back ${SEEK_JUMP} seconds`}
            title={`Back ${SEEK_JUMP} seconds (J)`}
            className={mediaButtonClassName('surface')}
          >
            <Rewind className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={media.toggle}
            disabled={idle}
            aria-label={playLabel}
            title={`${playLabel} (K)`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            {state.waiting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : state.playing ? (
              <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
            ) : (
              <Play
                className="h-5 w-5 translate-x-px fill-current"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => media.seekBy(SEEK_JUMP)}
            disabled={idle}
            aria-label={`Forward ${SEEK_JUMP} seconds`}
            title={`Forward ${SEEK_JUMP} seconds (L)`}
            className={mediaButtonClassName('surface')}
          >
            <FastForward className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <MuteButton media={media} tone="surface" disabled={idle} />
          {/* A phone sets the volume with its own buttons. */}
          <MediaSlider
            label="Volume"
            tone="surface"
            value={state.muted ? 0 : state.volume}
            max={1}
            step={0.05}
            valueText={`${Math.round((state.muted ? 0 : state.volume) * 100)}%`}
            onChange={media.setVolume}
            disabled={idle}
            className="ml-1 hidden w-14 shrink-0 [@container(min-width:21rem)]:[@media(pointer:fine)]:flex"
          />
        </div>
      </div>
    </div>
  )
}

function Timeline({
  audio,
  media,
  disabled,
}: {
  audio: React.RefObject<HTMLAudioElement | null>
  media: ReturnType<typeof useMedia>
  disabled: boolean
}) {
  const { duration, playing } = media.state
  const { time, buffered } = useMediaProgress(audio, playing)
  return (
    <>
      <MediaSlider
        label="Seek"
        tone="surface"
        value={time}
        max={duration}
        step={SEEK_STEP}
        secondary={buffered}
        valueText={`${spokenMediaTime(time)} of ${spokenMediaTime(duration)}`}
        hint={(seconds) => formatMediaTime(seconds, duration)}
        onChange={media.seekTo}
        disabled={disabled || duration === 0}
      />
      <div className="flex justify-between text-xs font-medium tabular-nums text-muted-foreground">
        <span>{formatMediaTime(time, duration)}</span>
        <span>{duration ? formatMediaTime(duration) : '–:––'}</span>
      </div>
    </>
  )
}
