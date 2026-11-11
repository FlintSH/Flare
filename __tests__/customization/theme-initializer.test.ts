import { describe, expect, it } from 'vitest'

import { initialThemeStyles } from '@/components/theme/initial-theme-styles'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import {
  CLASSIC_PALETTE,
  SUPERSEDED_CLASSIC_PALETTES,
  defaultClassicColors,
} from '@/lib/customization/legacy-appearance'
import { LIGHT_PALETTE } from '@/lib/customization/schema'
import { paletteVariables } from '@/lib/customization/theme'

function declarations(css: string, selector: string) {
  const body = css.slice(css.indexOf(`${selector}{`) + selector.length + 1)
  return Object.fromEntries(
    body
      .slice(0, body.indexOf('}'))
      .split(';')
      .filter((value) => value.includes(':'))
      .map((value) => value.split(':').map((part) => part.trim()))
  )
}

describe('initial server-rendered theme', () => {
  it.each(SUPERSEDED_CLASSIC_PALETTES)(
    'upgrades a saved untouched earlier default but retains a customized palette',
    (earlier) => {
      const config = structuredClone(DEFAULT_CONFIG)
      config.settings.appearance.customColors = { ...earlier }
      expect(
        configSchema.parse(config).settings.appearance.customColors
      ).toEqual(CLASSIC_PALETTE)
      expect(initialThemeStyles(config)).toContain(
        `--card: ${CLASSIC_PALETTE.card};`
      )
      config.settings.appearance.customColors.primary = '120 50% 50%'
      expect(
        configSchema.parse(config).settings.appearance.customColors.card
      ).toBe(earlier.card)
      expect(initialThemeStyles(config)).toContain(`--card: ${earlier.card};`)
      expect(initialThemeStyles(config)).toContain('--primary: 120 50% 50%;')
    }
  )

  it('recognizes both earlier defaults and leaves the current one alone', () => {
    expect(SUPERSEDED_CLASSIC_PALETTES).toHaveLength(2)
    for (const earlier of SUPERSEDED_CLASSIC_PALETTES)
      expect(earlier).not.toEqual(CLASSIC_PALETTE)
    expect(defaultClassicColors({ ...CLASSIC_PALETTE })).toEqual(
      CLASSIC_PALETTE
    )
  })

  it('fills every default Flare HSL token after setup saved an empty palette', () => {
    const fresh = structuredClone(DEFAULT_CONFIG)
    const completed = structuredClone(DEFAULT_CONFIG)
    completed.settings.general.setup.completed = true
    completed.settings.appearance.customColors = {}

    const before = initialThemeStyles(fresh)
    const after = initialThemeStyles(completed)
    expect(after).toBe(before)
    for (const [key, value] of Object.entries(
      DEFAULT_CONFIG.settings.appearance.customColors
    )) {
      const cssKey = key.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      )
      expect(after).toContain(`--${cssKey}: ${value};`)
    }
    expect(after).not.toContain('.dark{')
  })

  it('fills missing legacy colors while retaining each explicit customization', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.customColors = { primary: '120 50% 50%' }
    const css = initialThemeStyles(config)
    expect(css).toContain('--primary: 120 50% 50%;')
    expect(css).toContain(`--background: ${CLASSIC_PALETTE.background};`)
    expect(css).toContain('--foreground: 210 40% 98%;')
    expect(css).toContain(`--input: ${CLASSIC_PALETTE.input};`)
    expect(css).not.toContain('.dark{')
  })

  it('supplies a complete readable light palette for empty and sparse legacy settings', () => {
    const palettes: Record<string, string>[] = [{}, { primary: '120 50% 50%' }]
    for (const customColors of palettes) {
      const config = structuredClone(DEFAULT_CONFIG)
      config.settings.appearance.theme = 'light'
      config.settings.appearance.customColors = customColors
      const css = initialThemeStyles(config)
      expect(declarations(css, '.light')).toEqual(
        paletteVariables(config.settings.customization.published.theme.light)
      )
      expect(css).toContain(`--background: ${CLASSIC_PALETTE.background};`)
    }
  })

  it('keeps the default light palette while the studio palette is off', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.theme = 'light'
    const theme = config.settings.customization.published.theme
    // Trying a preset in the studio and switching its palette off again.
    theme.light = { ...theme.light, primary: '#0f766e', ring: '#0f766e' }
    theme.enabled = false
    const css = initialThemeStyles(config)
    expect(declarations(css, '.light')).toEqual(paletteVariables(LIGHT_PALETTE))
    // The tried teal appears nowhere, in either mode.
    expect(css).not.toContain(paletteVariables(theme.light)['--primary'])
  })

  it('lets an explicitly enabled appearance studio own the palette after fallback colors', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.customColors = { primary: '120 50% 50%' }
    const { theme } = config.settings.customization.published
    theme.enabled = true
    theme.dark.primary = '#ff0000'
    theme.light.primary = '#0000ff'
    const css = initialThemeStyles(config)
    expect(declarations(css, '.dark')).toEqual(paletteVariables(theme.dark))
    expect(declarations(css, '.light')).toMatchObject(
      paletteVariables(theme.light)
    )
    expect(css.indexOf('.dark{')).toBeGreaterThan(
      css.indexOf('--primary: 120 50% 50%;')
    )
  })

  it('recovery ignores both legacy and published custom colors', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.customColors = { primary: '123 45% 67%' }
    config.settings.customization.published.theme.enabled = true
    config.settings.customization.published.theme.dark.primary = '#ff0000'
    const css = initialThemeStyles(config, true)
    expect(css).not.toContain('123 45% 67%')
    expect(declarations(css, '.dark')).toEqual(
      paletteVariables(
        DEFAULT_CONFIG.settings.customization.published.theme.dark
      )
    )
    expect(css).toContain(`--background: ${CLASSIC_PALETTE.background};`)
  })
})
