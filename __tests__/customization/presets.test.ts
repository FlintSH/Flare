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

  it('steps default dark surfaces up from the page without glaring overlays', () => {
    const { background, card, popover, accent, border } = DARK_PALETTE
    expect(luminance(card)).toBeGreaterThan(luminance(background))
    expect(luminance(popover)).toBeGreaterThan(luminance(card))
    // Hover fills must show on dialogs and menus, not only on panels.
    expect(contrast(accent, popover)).toBeGreaterThan(1.2)
    expect(contrast(border, card)).toBeGreaterThan(1.5)
    // Dialogs and menus stay dark navy rather than a light slate sheet.
    const lift = contrast(popover, background)
    expect(lift).toBeGreaterThan(1.15)
    expect(lift).toBeLessThan(1.5)
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
