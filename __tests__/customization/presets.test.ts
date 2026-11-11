import { describe, expect, it } from 'vitest'

import { PALETTE_PRESETS, presetPalettes } from '@/lib/customization/presets'
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  paletteSchema,
} from '@/lib/customization/schema'

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
const toGamma = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055

function toOklab(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) =>
    toLinear(parseInt(hex.slice(index, index + 2), 16) / 255)
  )
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** `color-mix(in oklab, a weight, b)` as app/globals.css derives dark surfaces. */
function mix(a: string, b: string, weight: number) {
  const [L, A, B] = toOklab(a).map(
    (value, index) => value * weight + toOklab(b)[index] * (1 - weight)
  )
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return (
    '#' +
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
      .map((channel) =>
        Math.round(toGamma(Math.min(1, Math.max(0, channel))) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

describe('palette presets', () => {
  it('keeps default text readable on raised and hovered dark surfaces', () => {
    for (const surface of [
      'background',
      'card',
      'popover',
      'secondary',
      'muted',
      'accent',
    ] as const) {
      expect(
        contrast(DARK_PALETTE.foreground, DARK_PALETTE[surface])
      ).toBeGreaterThan(4.5)
      expect(
        contrast(DARK_PALETTE.mutedForeground, DARK_PALETTE[surface])
      ).toBeGreaterThan(4.5)
    }
  })

  it('steps rendered dark surfaces up from the page without glaring overlays', () => {
    const p = DARK_PALETTE
    // The colours the dark theme actually paints (app/globals.css).
    const panel = mix(p.card, p.cardForeground, 0.96)
    const overlay = mix(p.popover, p.foreground, 0.93)
    const control = mix(p.mutedForeground, p.input, 0.55)
    expect(contrast(panel, p.background)).toBeGreaterThan(1.1)
    expect(contrast(overlay, panel)).toBeGreaterThan(1.15)
    // Dialogs and menus stay dark navy rather than a light slate sheet.
    expect(contrast(overlay, p.background)).toBeLessThan(1.6)
    // Hover fills show on panels and inside menus.
    expect(contrast(p.accent, panel)).toBeGreaterThan(1.5)
    expect(contrast(p.accent, overlay)).toBeGreaterThan(1.35)
    // A hovered tab never outshines the selected one.
    expect(luminance(p.secondary)).toBeGreaterThanOrEqual(luminance(p.accent))
    // Muted fills (thumbnails, skeletons) still show at half opacity.
    expect(contrast(mix(p.muted, panel, 0.5), panel)).toBeGreaterThan(1.1)
    expect(contrast(p.border, panel)).toBeGreaterThan(1.5)
    // Menu separators use the border colour in dark mode.
    expect(contrast(p.border, overlay)).toBeGreaterThan(1.2)
    expect(contrast(control, panel)).toBeGreaterThan(3)
    expect(contrast(control, overlay)).toBeGreaterThan(3)
    expect(contrast(p.mutedForeground, overlay)).toBeGreaterThan(4.5)
  })

  it('keeps Midnight on the default palettes, with the accent as focus ring', () => {
    const expected = {
      light: { ...LIGHT_PALETTE, ring: LIGHT_PALETTE.primary },
      dark: { ...DARK_PALETTE, ring: DARK_PALETTE.primary },
    }
    expect(presetPalettes(PALETTE_PRESETS.midnight)).toEqual(expected)
    // The studio and setup pass copies with extra display fields.
    const studioCopy = { name: 'Midnight', ...PALETTE_PRESETS.midnight }
    expect(presetPalettes(studioCopy)).toEqual(expected)
  })

  it.each(
    Object.entries(PALETTE_PRESETS).filter(([name]) => name !== 'midnight')
  )('gives %s valid palettes with neutrals in its own hue', (_name, preset) => {
    const { light, dark } = presetPalettes(preset)
    expect(paletteSchema.safeParse(light).success).toBe(true)
    expect(paletteSchema.safeParse(dark).success).toBe(true)
    expect(light.primary).toBe(preset.lightAccent)
    expect(dark.primary).toBe(preset.accent)
    for (const key of [
      'secondary',
      'muted',
      'accent',
      'border',
      'input',
    ] as const)
      expect(dark[key]).toBe(preset.line)
    expect(dark.mutedForeground).toBe(preset.mutedForeground)
  })

  it.each(
    Object.entries(PALETTE_PRESETS).filter(([name]) => name !== 'midnight')
  )('keeps %s secondary text readable and its lines quiet', (_name, preset) => {
    const { dark } = presetPalettes(preset)
    expect(contrast(dark.mutedForeground, dark.background)).toBeGreaterThan(6.5)
    // Secondary text also sits on the secondary and muted fills (tabs,
    // badges), which take the line colour.
    expect(contrast(dark.mutedForeground, dark.secondary)).toBeGreaterThan(4.5)
    expect(contrast(dark.foreground, dark.background)).toBeGreaterThan(15)
    const line = contrast(dark.border, dark.background)
    expect(line).toBeGreaterThan(1.3)
    expect(line).toBeLessThan(1.8)
  })
})
