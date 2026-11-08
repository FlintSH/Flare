import { describe, expect, it } from 'vitest'

import { initialThemeStyles } from '@/components/theme/initial-theme-styles'

import { DEFAULT_CONFIG } from '@/lib/config'
import { PALETTE_PRESETS, presetPalettes } from '@/lib/customization/presets'
import { DARK_PALETTE, LIGHT_PALETTE } from '@/lib/customization/schema'
import { paletteVariables, themeStyles } from '@/lib/customization/theme'

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(text: string, surface: string) {
  const values = [luminance(text), luminance(surface)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('placeholder color roles', () => {
  it.each(Object.entries(PALETTE_PRESETS))(
    'keeps %s hints opaque, distinct from values and readable on field surfaces',
    (_, preset) => {
      for (const palette of Object.values(presetPalettes(preset))) {
        const before = structuredClone(palette)
        const hint = paletteVariables(palette)['--placeholder-text']
        expect(hint).toMatch(/^#[a-f\d]{6}$/)
        expect(hint).not.toBe(palette.foreground)
        for (const surface of [
          palette.background,
          palette.card,
          palette.popover,
        ])
          expect(contrast(hint, surface)).toBeGreaterThanOrEqual(7)
        expect(palette).toEqual(before)
      }
    }
  )

  it.each([
    { mode: 'dark', palette: DARK_PALETTE },
    { mode: 'light', palette: LIGHT_PALETTE },
  ])('keeps default $mode hints at the stronger text target', ({ palette }) => {
    const hint = paletteVariables(palette)['--placeholder-text']
    for (const surface of [palette.background, palette.card, palette.popover])
      expect(contrast(hint, surface)).toBeGreaterThanOrEqual(7)
  })

  it('can use full muted text when its quieter mix cannot reach the stronger target', () => {
    const hint = paletteVariables(DARK_PALETTE)['--placeholder-text']
    expect(hint).toBe(DARK_PALETTE.mutedForeground)
    expect(contrast(hint, DARK_PALETTE.background)).toBeGreaterThanOrEqual(7)
  })

  it('moves toward foreground when custom muted text only reaches the basic text threshold', () => {
    const palette = { ...LIGHT_PALETTE, mutedForeground: '#767676' }
    const hint = paletteVariables(palette)['--placeholder-text']
    expect(contrast(hint, palette.background)).toBeGreaterThanOrEqual(7)
    expect(contrast(hint, palette.card)).toBeGreaterThanOrEqual(7)
    expect(luminance(hint)).toBeLessThanOrEqual(
      luminance(palette.mutedForeground)
    )
  })

  it('uses the configured foreground to recover readable hints from a low-contrast custom muted color', () => {
    const palette = { ...DARK_PALETTE, mutedForeground: '#334155' }
    expect(contrast(palette.mutedForeground, palette.background)).toBeLessThan(
      4.5
    )
    const hint = paletteVariables(palette)['--placeholder-text']
    expect(contrast(hint, palette.background)).toBeGreaterThanOrEqual(7)
    expect(hint).not.toBe(palette.mutedForeground)
    expect(palette.mutedForeground).toBe('#334155')
  })

  it('retains readable configured text when the palette cannot reach the stronger target', () => {
    const palette = {
      ...LIGHT_PALETTE,
      mutedForeground: '#6c6c6c',
      foreground: '#6c6c6c',
    }
    const before = structuredClone(palette)
    const hint = paletteVariables(palette)['--placeholder-text']
    for (const surface of [palette.background, palette.card, palette.popover])
      expect(contrast(hint, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hint, palette.background)).toBeLessThan(7)
    expect(palette).toEqual(before)
  })

  it('keeps output safe and the saved palette intact when custom surfaces conflict', () => {
    const palette = {
      ...DARK_PALETTE,
      background: '#000000',
      card: '#777777',
      popover: '#ffffff',
    }
    const before = structuredClone(palette)
    expect(paletteVariables(palette)['--placeholder-text']).toMatch(
      /^#[a-f\d]{6}$/
    )
    expect(palette).toEqual(before)
  })

  it('emits the same scoped draft role as the published studio palette', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    const document = config.settings.customization.published
    document.theme.enabled = true
    document.theme.dark = presetPalettes(PALETTE_PRESETS.tide).dark
    for (const mode of ['light', 'dark'] as const) {
      const draftRole = paletteVariables(document.theme[mode])[
        '--placeholder-text'
      ]
      expect(themeStyles(document)).toContain(`--placeholder-text:${draftRole}`)
    }
  })

  it('derives the legacy dark role from effective classic colors, independently of an unpublished studio palette', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.customColors.mutedForeground = '120 20% 40%'
    config.settings.customization.published.theme.dark.mutedForeground =
      '#ff0000'
    const before = structuredClone(config)
    const role = initialThemeStyles(config).match(
      /--placeholder-text:\s*(#[a-f\d]{6})/
    )?.[1]
    const expected = paletteVariables({
      ...DARK_PALETTE,
      mutedForeground: '#527a52',
    })['--placeholder-text']
    expect(role).toBe(expected)
    expect(contrast(role!, DARK_PALETTE.background)).toBeGreaterThanOrEqual(7)
    expect(config).toEqual(before)
  })
})
