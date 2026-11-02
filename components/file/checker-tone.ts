/**
 * Transparent images sit on a checkerboard. One board can't suit every
 * image: dark artwork vanishes on a dark board and white artwork on a light
 * one. These helpers look at the image's own pixels once it has loaded and
 * pick the board it shows up on.
 */

/**
 * `opaque` for images without see-through pixels; `none` for images that
 * are opaque apart from their edges (rounded corners, window shadows), which
 * read best on the page itself; `null` when the pixels can't be read.
 */
export type CheckerTone = 'light' | 'dark' | 'none' | 'opaque' | null

const SAMPLE = 48
/** Edge band ignored when deciding whether an image is transparent. */
const MARGIN = 7
/** Share of the inner area that must be see-through to show a board. */
const TRANSPARENT_INSIDE = 0.1
/** Light artwork (mostly above this brightness) gets the dark board. */
const LIGHT_ARTWORK = 0.6

/**
 * The board for a square RGBA sample of an image (`size` x `size`): none
 * unless the inside of the image is see-through, then light behind dark
 * artwork and dark behind light artwork.
 */
export function checkerToneFromPixels(
  data: Uint8ClampedArray,
  size: number,
  margin = MARGIN
): Exclude<CheckerTone, null> {
  let inside = 0
  let transparentInside = 0
  let transparent = 0
  let weight = 0
  let brightness = 0
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4
    const x = pixel % size
    const y = Math.floor(pixel / size)
    const alpha = data[index + 3] / 255
    if (alpha < 0.95) transparent += 1
    if (x >= margin && y >= margin && x < size - margin && y < size - margin) {
      inside += 1
      if (alpha < 0.5) transparentInside += 1
    }
    weight += alpha
    brightness +=
      (alpha *
        (0.2126 * data[index] +
          0.7152 * data[index + 1] +
          0.0722 * data[index + 2])) /
      255
  }
  if (!transparent) return 'opaque'
  if (!weight || !inside || transparentInside / inside < TRANSPARENT_INSIDE)
    return 'none'
  return brightness / weight > LIGHT_ARTWORK ? 'dark' : 'light'
}

export function checkerToneFor(image: HTMLImageElement): CheckerTone {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE)
    return checkerToneFromPixels(
      context.getImageData(0, 0, SAMPLE, SAMPLE).data,
      SAMPLE
    )
  } catch {
    // Images from another origin (direct storage links) can't be read; they
    // keep the theme's board.
    return null
  }
}

/** The checkerboard class for a tone; the theme's board when unknown. */
export function checkerClassName(tone: CheckerTone) {
  return tone === 'none' || tone === 'opaque'
    ? ''
    : tone === 'light'
      ? 'bg-checker checker-light'
      : tone === 'dark'
        ? 'bg-checker checker-dark'
        : 'bg-checker'
}
