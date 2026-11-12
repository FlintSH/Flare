import { describe, expect, it } from 'vitest'

import {
  PLAYBACK_RATES,
  bufferedUntil,
  formatMediaTime,
  formatPlaybackRate,
  mediaKeyAction,
  nextPlaybackRate,
  spokenMediaTime,
} from '@/components/media/media-utils'

describe('formatMediaTime', () => {
  it('shows minutes and seconds', () => {
    expect(formatMediaTime(0)).toBe('0:00')
    expect(formatMediaTime(5.9)).toBe('0:05')
    expect(formatMediaTime(65)).toBe('1:05')
    expect(formatMediaTime(600)).toBe('10:00')
  })

  it('adds hours once the media runs an hour, so both clocks match', () => {
    expect(formatMediaTime(3725)).toBe('1:02:05')
    expect(formatMediaTime(65, 3725)).toBe('0:01:05')
    expect(formatMediaTime(65, 3599)).toBe('1:05')
  })

  // A file reports no duration until its metadata loads, and a live stream
  // never does.
  it('reads an unknown position as zero', () => {
    for (const unknown of [NaN, Infinity, -1])
      expect(formatMediaTime(unknown), String(unknown)).toBe('0:00')
    expect(formatMediaTime(65, NaN)).toBe('1:05')
  })
})

describe('spokenMediaTime', () => {
  it('says a position in words', () => {
    expect(spokenMediaTime(0)).toBe('0 seconds')
    expect(spokenMediaTime(1)).toBe('1 second')
    expect(spokenMediaTime(65)).toBe('1 minute 5 seconds')
    expect(spokenMediaTime(120)).toBe('2 minutes')
    expect(spokenMediaTime(3725)).toBe('1 hour 2 minutes 5 seconds')
    expect(spokenMediaTime(NaN)).toBe('0 seconds')
  })
})

describe('bufferedUntil', () => {
  const ranges = (...pairs: [number, number][]) => ({
    length: pairs.length,
    start: (index: number) => pairs[index][0],
    end: (index: number) => pairs[index][1],
  })

  it('finds the end of the range that holds the position', () => {
    expect(bufferedUntil(ranges([0, 12]), 3)).toBe(12)
    expect(bufferedUntil(ranges([0, 12], [30, 45]), 31)).toBe(45)
  })

  // After a seek the browser buffers from the nearest keyframe, which can
  // start a moment after the position asked for.
  it('counts a range that starts just after the position', () => {
    expect(bufferedUntil(ranges([20.1, 28]), 20)).toBe(28)
  })

  it('reports nothing buffered ahead outside every range', () => {
    expect(bufferedUntil(ranges(), 5)).toBe(5)
    expect(bufferedUntil(ranges([0, 12]), 20)).toBe(20)
  })
})

describe('playback rates', () => {
  it('steps through every speed and back to normal', () => {
    let rate = 1
    const seen = [rate]
    for (let step = 0; step < PLAYBACK_RATES.length; step++) {
      rate = nextPlaybackRate(rate)
      seen.push(rate)
    }
    expect(seen).toEqual([1, 1.25, 1.5, 2, 0.5, 0.75, 1])
  })

  it('returns to normal from a speed it does not offer', () => {
    expect(nextPlaybackRate(3)).toBe(1)
  })

  it('writes a speed the way the button shows it', () => {
    expect(formatPlaybackRate(1)).toBe('1×')
    expect(formatPlaybackRate(1.25)).toBe('1.25×')
    expect(formatPlaybackRate(0.5)).toBe('0.5×')
  })
})

describe('mediaKeyAction', () => {
  const on = (key: string, onControl = false, video = true) =>
    mediaKeyAction({ key }, { video, onControl })

  it('maps the keys video sites use', () => {
    expect(on(' ')).toEqual({ type: 'toggle' })
    expect(on('k')).toEqual({ type: 'toggle' })
    expect(on('K')).toEqual({ type: 'toggle' })
    expect(on('ArrowLeft')).toEqual({ type: 'seek', by: -5 })
    expect(on('ArrowRight')).toEqual({ type: 'seek', by: 5 })
    expect(on('j')).toEqual({ type: 'seek', by: -10 })
    expect(on('l')).toEqual({ type: 'seek', by: 10 })
    expect(on('ArrowUp')).toEqual({ type: 'volume', by: 0.1 })
    expect(on('ArrowDown')).toEqual({ type: 'volume', by: -0.1 })
    expect(on('m')).toEqual({ type: 'mute' })
    expect(on('f')).toEqual({ type: 'fullscreen' })
    expect(on('Home')).toEqual({ type: 'seekTo', fraction: 0 })
    expect(on('End')).toEqual({ type: 'seekTo', fraction: 1 })
  })

  // A focused button activates on Space and a focused slider moves on the
  // arrows; taking those keys would make each control do two things.
  it('leaves Space and the arrows to a focused button or slider', () => {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Home'])
      expect(on(key, true), key).toBeNull()
    expect(on('k', true)).toEqual({ type: 'toggle' })
    expect(on('l', true)).toEqual({ type: 'seek', by: 10 })
    expect(on('m', true)).toEqual({ type: 'mute' })
  })

  it('has no full screen for audio', () => {
    expect(on('f', false, false)).toBeNull()
    expect(on('k', false, false)).toEqual({ type: 'toggle' })
  })

  it('leaves browser and system shortcuts alone', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey'])
      expect(
        mediaKeyAction(
          { key: 'f', [modifier]: true },
          { video: true, onControl: false }
        ),
        modifier
      ).toBeNull()
    expect(on('a')).toBeNull()
    expect(on('Tab')).toBeNull()
  })
})
