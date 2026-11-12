'use client'

import { Volume1, Volume2, VolumeX } from 'lucide-react'

import { cn } from '@/lib/utils'

import { formatPlaybackRate } from './media-utils'
import type { MediaControls } from './use-media'

/** `media` sits on the video; `surface` sits on a card in the theme's colours. */
export type MediaTone = 'media' | 'surface'

/** The player's small icon buttons. */
export function mediaButtonClassName(tone: MediaTone) {
  return cn(
    // Larger under a finger than under a pointer.
    'inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11',
    tone === 'media'
      ? 'text-white/90 hover:bg-white/15 hover:text-white focus-visible:ring-white'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
  )
}

export function MuteButton({
  media,
  tone,
  disabled,
}: {
  media: MediaControls
  tone: MediaTone
  disabled?: boolean
}) {
  const { muted, volume } = media.state
  const Icon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const label = muted ? 'Unmute' : 'Mute'
  return (
    <button
      type="button"
      onClick={media.toggleMute}
      disabled={disabled}
      aria-label={label}
      title={`${label} (M)`}
      className={mediaButtonClassName(tone)}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  )
}

/** Steps through the playback speeds; its face is the current one. */
export function SpeedButton({
  media,
  tone,
  disabled,
}: {
  media: MediaControls
  tone: MediaTone
  disabled?: boolean
}) {
  const rate = formatPlaybackRate(media.state.rate)
  return (
    <button
      type="button"
      onClick={media.cycleRate}
      disabled={disabled}
      aria-label={`Playback speed ${rate}. Change speed`}
      title="Playback speed"
      className={cn(mediaButtonClassName(tone), 'min-w-11')}
    >
      {rate}
    </button>
  )
}
