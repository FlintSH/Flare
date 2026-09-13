import { describe, expect, it } from 'vitest'

import { initialThemeStyles } from '@/components/theme/initial-theme-styles'

import { DEFAULT_CONFIG } from '@/lib/config'
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
  it('keeps every original Flare HSL token after setup saved an empty palette', () => {
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
    expect(css).toContain('--background: 222.2 84% 4.9%;')
    expect(css).toContain('--foreground: 210 40% 98%;')
    expect(css).toContain('--input: 217.2 32.6% 17.5%;')
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
      expect(css).toContain('--background: 222.2 84% 4.9%;')
    }
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
    expect(css).toContain('--background: 222.2 84% 4.9%;')
  })
})
