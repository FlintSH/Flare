import { describe, expect, it } from 'vitest'

import {
  checkerClassName,
  checkerToneFromPixels,
} from '@/components/file/checker-tone'

const SIZE = 48

/** A SIZE x SIZE RGBA sample drawn by `paint(x, y)` -> [r, g, b, a]. */
function sample(paint: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) data.set(paint(x, y), (y * SIZE + x) * 4)
  return data
}

const stripes = (ink: number[]) =>
  sample((x) => (x % 6 < 2 ? [...ink, 255] : [0, 0, 0, 0]))

describe('checkerToneFromPixels', () => {
  it('puts dark artwork on transparency on the light board', () => {
    expect(checkerToneFromPixels(stripes([31, 29, 25]), SIZE)).toBe('light')
  })

  it('puts white artwork on transparency on the dark board', () => {
    expect(checkerToneFromPixels(stripes([248, 250, 252]), SIZE)).toBe('dark')
  })

  it('shows no board for opaque images', () => {
    expect(
      checkerToneFromPixels(
        sample(() => [90, 120, 160, 255]),
        SIZE
      )
    ).toBe('opaque')
  })

  it('shows no board when only the edges are see-through', () => {
    // An app icon with rounded corners, and a window capture with a shadow.
    const corners = sample((x, y) =>
      Math.hypot(Math.min(x, SIZE - 1 - x), Math.min(y, SIZE - 1 - y)) < 3 &&
      (x < 3 || x > SIZE - 4) &&
      (y < 3 || y > SIZE - 4)
        ? [0, 0, 0, 0]
        : [20, 24, 32, 255]
    )
    const shadow = sample((x, y) =>
      x < 5 || y < 5 || x > SIZE - 6 || y > SIZE - 6
        ? [0, 0, 0, 60]
        : [240, 240, 240, 255]
    )
    expect(checkerToneFromPixels(corners, SIZE)).toBe('none')
    expect(checkerToneFromPixels(shadow, SIZE)).toBe('none')
  })

  it('shows no board for a fully transparent sample', () => {
    expect(
      checkerToneFromPixels(
        sample(() => [0, 0, 0, 0]),
        SIZE
      )
    ).toBe('none')
  })
})

describe('checkerClassName', () => {
  it('maps tones to board classes, keeping the theme board when unknown', () => {
    expect(checkerClassName('none')).toBe('')
    expect(checkerClassName('opaque')).toBe('')
    expect(checkerClassName('light')).toBe('bg-checker checker-light')
    expect(checkerClassName('dark')).toBe('bg-checker checker-dark')
    expect(checkerClassName(null)).toBe('bg-checker')
  })
})
