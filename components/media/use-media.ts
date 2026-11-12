'use client'

import { type RefObject, useCallback, useEffect, useState } from 'react'

import {
  type MediaKeyAction,
  bufferedUntil,
  nextPlaybackRate,
} from './media-utils'

export interface MediaState {
  /** Playing, or about to once enough has loaded. */
  playing: boolean
  /** Stalled while it loads more, with playback requested. */
  waiting: boolean
  /** Played to its end and not restarted. */
  ended: boolean
  /** Seconds; 0 until the file's metadata has loaded. */
  duration: number
  volume: number
  muted: boolean
  rate: number
}

const IDLE: MediaState = {
  playing: false,
  waiting: false,
  ended: false,
  duration: 0,
  volume: 1,
  muted: false,
  rate: 1,
}

function read(media: HTMLMediaElement): MediaState {
  return {
    playing: !media.paused && !media.ended,
    // HAVE_FUTURE_DATA: enough to play on from the current position.
    waiting: !media.paused && !media.ended && media.readyState < 3,
    ended: media.ended,
    duration: Number.isFinite(media.duration) ? media.duration : 0,
    volume: media.volume,
    muted: media.muted || media.volume === 0,
    rate: media.playbackRate,
  }
}

const STATE_EVENTS = [
  'play',
  'pause',
  'playing',
  'waiting',
  'stalled',
  'canplay',
  'ended',
  'seeked',
  'emptied',
  'loadedmetadata',
  'durationchange',
  'volumechange',
  'ratechange',
] as const

/**
 * The state of an audio or video element, kept in step with the element's own
 * events, and the actions the player's controls and shortcuts perform on it.
 * The element stays the source of truth, so the browser's own controls (a
 * headset button, the picture-in-picture window) change what is shown too.
 */
export function useMedia(ref: RefObject<HTMLMediaElement | null>) {
  const [state, setState] = useState<MediaState>(IDLE)

  useEffect(() => {
    const media = ref.current
    if (!media) return
    const sync = () => setState(read(media))
    sync()
    for (const event of STATE_EVENTS) media.addEventListener(event, sync)
    return () => {
      for (const event of STATE_EVENTS) media.removeEventListener(event, sync)
    }
  }, [ref])

  const toggle = useCallback(() => {
    const media = ref.current
    if (!media) return
    if (media.paused || media.ended) {
      // A refused play (no source yet, or the browser's autoplay policy)
      // leaves the element paused, which is what the controls then show.
      void media.play().catch(() => {})
    } else media.pause()
  }, [ref])

  const seekTo = useCallback(
    (seconds: number) => {
      const media = ref.current
      if (!media || !Number.isFinite(media.duration)) return
      media.currentTime = Math.min(Math.max(seconds, 0), media.duration)
    },
    [ref]
  )

  const seekBy = useCallback(
    (seconds: number) => {
      const media = ref.current
      if (media) seekTo(media.currentTime + seconds)
    },
    [ref, seekTo]
  )

  const setVolume = useCallback(
    (volume: number) => {
      const media = ref.current
      if (!media) return
      const next = Math.min(Math.max(volume, 0), 1)
      media.volume = next
      media.muted = next === 0
    },
    [ref]
  )

  const toggleMute = useCallback(() => {
    const media = ref.current
    if (!media) return
    // Unmuting a player whose volume was dragged to zero would stay silent.
    if (media.muted || media.volume === 0) {
      media.muted = false
      if (media.volume === 0) media.volume = 0.5
    } else media.muted = true
  }, [ref])

  const cycleRate = useCallback(() => {
    const media = ref.current
    if (media) media.playbackRate = nextPlaybackRate(media.playbackRate)
  }, [ref])

  /** Performs a keyboard shortcut; full screen is the video player's own. */
  const perform = useCallback(
    (action: MediaKeyAction) => {
      const media = ref.current
      if (!media) return
      switch (action.type) {
        case 'toggle':
          return toggle()
        case 'seek':
          return seekBy(action.by)
        case 'seekTo':
          return seekTo(action.fraction * (media.duration || 0))
        case 'volume':
          return setVolume((media.muted ? 0 : media.volume) + action.by)
        case 'mute':
          return toggleMute()
      }
    },
    [ref, toggle, seekBy, seekTo, setVolume, toggleMute]
  )

  return {
    state,
    toggle,
    seekTo,
    seekBy,
    setVolume,
    toggleMute,
    cycleRate,
    perform,
  }
}

export type MediaControls = ReturnType<typeof useMedia>

/**
 * The element's position and how far it has buffered, read every frame while
 * it plays so the progress bar moves smoothly, and on its own events
 * otherwise. Kept apart from `useMedia` so only the timeline re-renders.
 */
export function useMediaProgress(
  ref: RefObject<HTMLMediaElement | null>,
  playing: boolean
) {
  const [progress, setProgress] = useState({ time: 0, buffered: 0 })

  useEffect(() => {
    const media = ref.current
    if (!media) return
    const sync = () => {
      const time = media.currentTime
      const buffered = bufferedUntil(media.buffered, time)
      setProgress((previous) =>
        previous.time === time && previous.buffered === buffered
          ? previous
          : { time, buffered }
      )
    }
    sync()
    const events = ['timeupdate', 'seeking', 'seeked', 'progress', 'emptied']
    for (const event of events) media.addEventListener(event, sync)
    let frame = 0
    if (playing) {
      const tick = () => {
        sync()
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    return () => {
      cancelAnimationFrame(frame)
      for (const event of events) media.removeEventListener(event, sync)
    }
  }, [ref, playing])

  return progress
}
