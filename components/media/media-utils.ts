/**
 * Pure helpers for Flare's audio and video player: clock text, buffered
 * ranges, playback speeds and keyboard shortcuts. Browser-safe, no DOM access.
 */

const pad = (value: number) => String(value).padStart(2, '0')

function clock(seconds: number) {
  const whole =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return {
    hours: Math.floor(whole / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    seconds: whole % 60,
  }
}

/**
 * A position as `1:05`, or `0:01:05` when the media runs an hour or longer,
 * so the current time and the duration keep the same width.
 */
export function formatMediaTime(seconds: number, total = seconds): string {
  const time = clock(seconds)
  return time.hours > 0 || (Number.isFinite(total) && total >= 3600)
    ? `${time.hours}:${pad(time.minutes)}:${pad(time.seconds)}`
    : `${time.minutes}:${pad(time.seconds)}`
}

const unit = (value: number, noun: string) =>
  `${value} ${noun}${value === 1 ? '' : 's'}`

/** A position in words for screen readers: "1 minute 5 seconds". */
export function spokenMediaTime(seconds: number): string {
  const time = clock(seconds)
  const parts = [
    time.hours > 0 && unit(time.hours, 'hour'),
    time.minutes > 0 && unit(time.minutes, 'minute'),
    (time.seconds > 0 || (time.hours === 0 && time.minutes === 0)) &&
      unit(time.seconds, 'second'),
  ]
  return parts.filter(Boolean).join(' ')
}

/** The part of `TimeRanges` these helpers read. */
export interface BufferedRanges {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

/**
 * How far playback can continue from `time` without loading more: the end
 * of the buffered range that holds it, or `time` itself when none does.
 */
export function bufferedUntil(buffered: BufferedRanges, time: number): number {
  for (let index = 0; index < buffered.length; index++)
    // Ranges start a little after the position a seek asked for.
    if (buffered.start(index) <= time + 0.25 && buffered.end(index) >= time)
      return buffered.end(index)
  return time
}

/** The speeds the speed button steps through. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.5, 0.75] as const

/** The speed after `rate` in the cycle; an unknown rate returns to normal. */
export function nextPlaybackRate(rate: number): number {
  const index = PLAYBACK_RATES.findIndex((known) => known === rate)
  return index < 0 ? 1 : PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]
}

/** `1×`, `1.5×`. */
export function formatPlaybackRate(rate: number) {
  return `${Number(rate.toFixed(2))}×`
}

export type MediaKeyAction =
  | { type: 'toggle' }
  | { type: 'seek'; by: number }
  | { type: 'seekTo'; fraction: number }
  | { type: 'volume'; by: number }
  | { type: 'mute' }
  | { type: 'fullscreen' }

/** The part of a player a key was pressed on. */
export type MediaKeyTarget = 'player' | 'button' | 'slider'

/** Tells a player's buttons and sliders (range inputs) from the rest of it. */
export function mediaKeyTarget(target: EventTarget): MediaKeyTarget {
  const tag = (target as Partial<Element>).tagName
  return tag === 'BUTTON' ? 'button' : tag === 'INPUT' ? 'slider' : 'player'
}

/** Seconds the arrow keys and the J and L keys move by. */
export const SEEK_STEP = 5
export const SEEK_JUMP = 10

/**
 * What a key does in the player, in the layout video sites have taught
 * people: Space or K plays and pauses, the arrows seek and change the volume,
 * J and L jump ten seconds, M mutes and F toggles full screen.
 *
 * `on` is what the key was pressed on. A button keeps Space for itself, and
 * a slider keeps the arrows, Home and End; every other key works from there
 * as it does from the player.
 */
export function mediaKeyAction(
  event: {
    key: string
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
  },
  { video, on }: { video: boolean; on: MediaKeyTarget }
): MediaKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  switch (key) {
    case 'k':
      return { type: 'toggle' }
    case 'j':
      return { type: 'seek', by: -SEEK_JUMP }
    case 'l':
      return { type: 'seek', by: SEEK_JUMP }
    case 'm':
      return { type: 'mute' }
    case 'f':
      return video ? { type: 'fullscreen' } : null
  }
  if (key === ' ') return on === 'button' ? null : { type: 'toggle' }
  if (on === 'slider') return null
  switch (key) {
    case 'ArrowLeft':
      return { type: 'seek', by: -SEEK_STEP }
    case 'ArrowRight':
      return { type: 'seek', by: SEEK_STEP }
    case 'ArrowUp':
      return { type: 'volume', by: 0.1 }
    case 'ArrowDown':
      return { type: 'volume', by: -0.1 }
    case 'Home':
      return { type: 'seekTo', fraction: 0 }
    case 'End':
      return { type: 'seekTo', fraction: 1 }
  }
  return null
}
