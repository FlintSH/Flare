// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioPlayer } from '@/components/media/audio-player'
import { VideoPlayer } from '@/components/media/video-player'

/**
 * jsdom has the media element but plays nothing, so each test drives one the
 * way a browser would: its properties hold the state and its events
 * announce a change.
 */
function drive(media: HTMLMediaElement, initial: { duration?: number } = {}) {
  const state = {
    paused: true,
    ended: false,
    currentTime: 0,
    duration: initial.duration ?? NaN,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 4,
  }
  for (const key of Object.keys(state) as (keyof typeof state)[])
    Object.defineProperty(media, key, {
      configurable: true,
      get: () => state[key],
      set: (value) => {
        ;(state as Record<string, unknown>)[key] = value
        if (key === 'volume' || key === 'muted')
          media.dispatchEvent(new Event('volumechange'))
        if (key === 'playbackRate') media.dispatchEvent(new Event('ratechange'))
        if (key === 'currentTime') media.dispatchEvent(new Event('seeked'))
      },
    })
  Object.defineProperty(media, 'buffered', {
    configurable: true,
    get: () => ({ length: 0, start: () => 0, end: () => 0 }),
  })
  media.play = vi.fn(async () => {
    state.paused = false
    state.ended = false
    media.dispatchEvent(new Event('play'))
  })
  media.pause = vi.fn(() => {
    state.paused = true
    media.dispatchEvent(new Event('pause'))
  })
  const announce = (event: string, change: Partial<typeof state> = {}) =>
    act(() => {
      Object.assign(state, change)
      media.dispatchEvent(new Event(event))
    })
  return { state, announce }
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const slider = (name: string) =>
  screen.getByRole('slider', { name }) as HTMLInputElement

beforeEach(() => {
  // The timeline reads the position every frame while media plays.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AudioPlayer', () => {
  function open({ idle = false } = {}) {
    const src = idle ? undefined : '/file.mp3'
    const onError = vi.fn()
    const view = render(
      createElement(AudioPlayer, { src, name: 'Chime.mp3', onError })
    )
    const audio = view.container.querySelector('audio')!
    return { ...view, audio, onError, ...drive(audio) }
  }

  it('is named, and draws its own controls instead of the browser’s', () => {
    const { audio } = open()
    expect(screen.getByRole('group', { name: 'Chime.mp3 audio player' }))
    expect(audio.controls).toBe(false)
    expect(audio.getAttribute('src')).toBe('/file.mp3')
  })

  // The share page shows the player before it knows the file's address.
  it('waits, with every control disabled, until it has a file', () => {
    const { audio } = open({ idle: true })
    expect(audio.hasAttribute('src')).toBe(false)
    for (const name of [
      'Play',
      'Back 10 seconds',
      'Forward 10 seconds',
      'Mute',
      /Playback speed/,
    ])
      expect(button(name)).toHaveProperty('disabled', true)
    expect(slider('Seek').disabled).toBe(true)
  })

  it('shows the length once the file reports it', async () => {
    const { announce } = open()
    expect(screen.getByText('–:––')).toBeTruthy()
    await announce('loadedmetadata', { duration: 205 })
    expect(screen.getByText('3:25')).toBeTruthy()
    expect(slider('Seek').disabled).toBe(false)
    expect(slider('Seek').getAttribute('aria-valuetext')).toBe(
      '0 seconds of 3 minutes 25 seconds'
    )
  })

  it('plays and pauses, following the element', async () => {
    const { audio, announce } = open()
    await act(async () => fireEvent.click(button('Play')))
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(button('Pause')).toBeTruthy()
    // Paused from outside the page, such as a headset button.
    await announce('pause', { paused: true })
    expect(button('Play')).toBeTruthy()
  })

  it('skips ten seconds each way and stays inside the file', async () => {
    const { audio, announce } = open()
    await announce('loadedmetadata', { duration: 25 })
    fireEvent.click(button('Forward 10 seconds'))
    expect(audio.currentTime).toBe(10)
    fireEvent.click(button('Forward 10 seconds'))
    fireEvent.click(button('Forward 10 seconds'))
    expect(audio.currentTime).toBe(25)
    for (let press = 0; press < 4; press++)
      fireEvent.click(button('Back 10 seconds'))
    expect(audio.currentTime).toBe(0)
  })

  it('moves the timeline with the keyboard from wherever it is', async () => {
    const { audio, announce } = open()
    await announce('loadedmetadata', { duration: 205 })
    await act(async () => {
      audio.currentTime = 21
    })
    fireEvent.keyDown(slider('Seek'), { key: 'ArrowRight' })
    expect(audio.currentTime).toBe(26)
    fireEvent.keyDown(slider('Seek'), { key: 'ArrowLeft' })
    fireEvent.keyDown(slider('Seek'), { key: 'ArrowLeft' })
    expect(audio.currentTime).toBe(16)
    fireEvent.keyDown(slider('Seek'), { key: 'End' })
    expect(audio.currentTime).toBe(205)
    fireEvent.keyDown(slider('Seek'), { key: 'Home' })
    expect(audio.currentTime).toBe(0)
  })

  it('mutes, and unmuting a silent player makes it audible', async () => {
    const { audio } = open()
    await act(async () => fireEvent.click(button('Mute')))
    expect(audio.muted).toBe(true)
    await act(async () => fireEvent.click(button('Unmute')))
    expect(audio.muted).toBe(false)
    // Dragged to silence, then unmuted.
    await act(async () => {
      audio.volume = 0
    })
    expect(button('Unmute')).toBeTruthy()
    await act(async () => fireEvent.click(button('Unmute')))
    expect(audio.volume).toBe(0.5)
  })

  it('steps through the speeds and shows the current one', async () => {
    const { audio } = open()
    expect(button(/Playback speed 1×/).textContent).toBe('1×')
    await act(async () => fireEvent.click(button(/Playback speed/)))
    expect(audio.playbackRate).toBe(1.25)
    expect(button(/Playback speed 1.25×/).textContent).toBe('1.25×')
  })

  it('takes the shortcuts from any of its controls', async () => {
    const { audio, announce } = open()
    await announce('loadedmetadata', { duration: 205 })
    fireEvent.keyDown(button('Mute'), { key: 'l' })
    expect(audio.currentTime).toBe(10)
    fireEvent.keyDown(button('Mute'), { key: 'j' })
    expect(audio.currentTime).toBe(0)
    await act(async () => fireEvent.keyDown(button('Mute'), { key: 'k' }))
    expect(audio.play).toHaveBeenCalledTimes(1)
    // Space belongs to the focused button; the arrows don't.
    fireEvent.keyDown(button('Mute'), { key: ' ' })
    expect(audio.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(button('Mute'), { key: 'ArrowRight' })
    expect(audio.currentTime).toBe(5)
    fireEvent.keyDown(button('Mute'), { key: 'ArrowDown' })
    expect(audio.volume).toBeCloseTo(0.9)
    // A slider keeps its arrows, and Space plays and pauses from it.
    await act(async () => fireEvent.keyDown(slider('Volume'), { key: ' ' }))
    expect(audio.pause).toHaveBeenCalledTimes(1)
  })

  // A click on the player, or a drag of a slider, leaves focus on the player.
  it('takes focus itself, and every shortcut from there', async () => {
    const { audio, announce } = open()
    const player = screen.getByRole('group', { name: 'Chime.mp3 audio player' })
    expect(player.tabIndex).toBe(0)
    await announce('loadedmetadata', { duration: 205 })
    fireEvent.keyDown(player, { key: 'End' })
    expect(audio.currentTime).toBe(205)
    fireEvent.keyDown(player, { key: 'Home' })
    expect(audio.currentTime).toBe(0)
    fireEvent.keyDown(player, { key: 'ArrowDown' })
    expect(audio.volume).toBeCloseTo(0.9)
    await act(async () => fireEvent.keyDown(player, { key: ' ' }))
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('is no tab stop while it waits for its file', () => {
    open({ idle: true })
    const player = screen.getByRole('group', { name: 'Chime.mp3 audio player' })
    expect(player.hasAttribute('tabindex')).toBe(false)
  })

  it('reports a file the browser can’t play', () => {
    const { audio, onError } = open()
    fireEvent.error(audio)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('VideoPlayer', () => {
  function open() {
    const onError = vi.fn()
    const view = render(
      createElement(VideoPlayer, {
        src: '/clip.mp4',
        name: 'Clip.mp4',
        onError,
        className: 'max-h-80',
      })
    )
    const video = view.container.querySelector('video')!
    const frame = screen.getByRole('group', { name: 'Clip.mp4 video player' })
    return { ...view, video, frame, onError, ...drive(video) }
  }

  it('is named, and draws its own controls instead of the browser’s', () => {
    const { video } = open()
    expect(video.controls).toBe(false)
    expect(video.getAttribute('src')).toBe('/clip.mp4')
    expect(video.hasAttribute('playsinline')).toBe(true)
    for (const name of ['Play', 'Mute', /Playback speed/])
      expect(button(name)).toBeTruthy()
  })

  // The page holds a 16:9 frame while the video loads; another shape takes
  // over once the video reports its own.
  it('holds a 16:9 frame until the video reports its shape', async () => {
    const { video, frame } = open()
    const ratio = () => Number.parseFloat(frame.style.aspectRatio)
    expect(ratio()).toBeCloseTo(16 / 9, 3)
    Object.defineProperty(video, 'videoWidth', { value: 720 })
    Object.defineProperty(video, 'videoHeight', { value: 1280 })
    await act(async () => fireEvent.loadedMetadata(video))
    expect(ratio()).toBeCloseTo(720 / 1280, 3)
  })

  it('plays on Space and K from the player, and offers Replay at the end', async () => {
    const { video, frame, announce } = open()
    await act(async () => fireEvent.keyDown(frame, { key: ' ' }))
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(button('Pause')).toBeTruthy()
    await act(async () => fireEvent.keyDown(frame, { key: 'k' }))
    expect(video.pause).toHaveBeenCalledTimes(1)
    await announce('ended', { ended: true, paused: true })
    expect(button('Replay')).toBeTruthy()
  })

  it('seeks, changes the volume and mutes from the keyboard', async () => {
    const { video, frame, announce } = open()
    await announce('loadedmetadata', { duration: 42 })
    fireEvent.keyDown(frame, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(5)
    fireEvent.keyDown(frame, { key: 'l' })
    expect(video.currentTime).toBe(15)
    fireEvent.keyDown(frame, { key: 'End' })
    expect(video.currentTime).toBe(42)
    fireEvent.keyDown(frame, { key: 'ArrowDown' })
    expect(video.volume).toBeCloseTo(0.9)
    fireEvent.keyDown(frame, { key: 'm' })
    expect(video.muted).toBe(true)
  })

  it('seeks with the arrows from a focused button', async () => {
    const { video, announce } = open()
    await announce('loadedmetadata', { duration: 42 })
    fireEvent.keyDown(button('Mute'), { key: 'ArrowRight' })
    expect(video.currentTime).toBe(5)
    // Space would press the button instead.
    fireEvent.keyDown(button('Mute'), { key: ' ' })
    expect(video.play).not.toHaveBeenCalled()
  })

  // The controls go 2.5 seconds after the pointer rests, not 2.5 seconds
  // after it first moved.
  it('keeps its controls up while the pointer keeps moving', async () => {
    vi.useFakeTimers()
    try {
      const { frame } = open()
      const hidden = () => frame.className.includes('cursor-none')
      await act(async () => fireEvent.keyDown(frame, { key: 'k' }))
      expect(hidden()).toBe(false)
      await act(async () => void vi.advanceTimersByTime(2000))
      fireEvent.pointerMove(frame)
      await act(async () => void vi.advanceTimersByTime(2000))
      // Four seconds in, but two since the pointer last moved.
      expect(hidden()).toBe(false)
      await act(async () => void vi.advanceTimersByTime(600))
      expect(hidden()).toBe(true)
      await act(async () => void fireEvent.pointerMove(frame))
      expect(hidden()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('plays and pauses on a mouse click, but not on a tap', async () => {
    const { video } = open()
    fireEvent.pointerDown(video, { pointerType: 'mouse' })
    await act(async () => fireEvent.click(video))
    expect(video.play).toHaveBeenCalledTimes(1)
    // A tap brings the controls up; the play button is there for a finger.
    fireEvent.pointerDown(video, { pointerType: 'touch' })
    await act(async () => fireEvent.click(video))
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.pause).not.toHaveBeenCalled()
  })

  // Full screen holds the player, so Flare's controls stay with the video.
  it('takes the whole player full screen, not the bare video', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: true,
    })
    const { frame } = open()
    const request = vi.fn(async () => {})
    frame.requestFullscreen = request
    await act(async () => {})
    await act(async () => fireEvent.click(button('Full screen')))
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(frame, { key: 'f' })
    expect(request).toHaveBeenCalledTimes(2)
    Reflect.deleteProperty(document, 'fullscreenEnabled')
  })

  it('leaves out full screen and picture-in-picture where the browser has none', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Picture-in-picture' })
    ).toBeNull()
  })

  it('reports a file the browser can’t play', () => {
    const { video, onError } = open()
    fireEvent.error(video)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
