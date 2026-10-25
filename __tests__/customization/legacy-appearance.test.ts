import { createElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { initialThemeStyles } from '@/components/theme/initial-theme-styles'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import {
  MAX_LEGACY_COLORS,
  legacyAppearanceUpdateSchema,
  legacyColorValue,
  legacyColors,
  legacyTheme,
} from '@/lib/customization/legacy-appearance'

describe('classic appearance values', () => {
  it('normalizes HSL triplets and hex colors to the form the theme uses', () => {
    expect(legacyColorValue('222.2 84% 4.9%')).toBe('222.2 84% 4.9%')
    expect(legacyColorValue('  120   50 50 ')).toBe('120 50% 50%')
    expect(legacyColorValue('#ff0000')).toBe('0.0 100.0% 50.0%')
    expect(legacyColorValue('#F00')).toBe('0.0 100.0% 50.0%')
    expect(legacyColorValue('#1e293b')).toBe('217.2 32.6% 17.5%')
  })

  it('rejects anything else, including values that leave the declaration', () => {
    for (const value of [
      '',
      'red',
      'hsl(0 100% 50%)',
      '361 50% 50%',
      '120 101% 50%',
      '-1 50% 50%',
      '#ff00',
      '#ggg',
      '1 1% 1%;}</style><script>alert(1)</script>',
      '#fff} body{background:url(https://attacker.test/beacon)}',
      '1 1% 1% !important',
      5,
      null,
    ])
      expect(legacyColorValue(value)).toBeNull()
  })

  it('keeps only safe entries without throwing on saved data of any shape', () => {
    expect(
      legacyColors({
        primary: '#ff0000',
        accent: 'red',
        'x;}body{': '1 1% 1%',
        Ring: '1 1% 1%',
        ring: '1 1% 1%',
      })
    ).toEqual({ primary: '0.0 100.0% 50.0%', ring: '1 1% 1%' })
    for (const value of [undefined, null, 'x', 5, ['1 1% 1%']])
      expect(legacyColors(value)).toEqual({})
    const many = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`c${index}`, '1 1% 1%'])
    )
    expect(Object.keys(legacyColors(many))).toHaveLength(MAX_LEGACY_COLORS)
  })

  it('limits the classic theme to dark, light, or system', () => {
    expect(legacyTheme('light')).toBe('light')
    expect(legacyTheme('system')).toBe('system')
    expect(legacyTheme('dark"</script><script>alert(1)</script>')).toBe('dark')
    expect(legacyTheme(undefined)).toBe('dark')
  })

  it('reads an old configuration with unsafe classic values instead of failing', () => {
    const saved = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    saved.settings.appearance.theme = '</script><script>alert(1)</script>'
    saved.settings.appearance.customColors = {
      primary: '1 1% 1%;}</style><script>alert(1)</script>',
      accent: 7,
      ring: '#ffffff',
    }
    const parsed = configSchema.parse(saved)
    expect(parsed.settings.appearance.theme).toBe('dark')
    expect(parsed.settings.appearance.customColors).toEqual({
      ring: '0.0 0.0% 100.0%',
    })
    const {
      theme: _theme,
      customColors: _colors,
      ...rest
    } = saved.settings.appearance
    saved.settings.appearance = rest
    expect(configSchema.parse(saved).settings.appearance).toMatchObject({
      theme: 'dark',
      customColors: {},
    })
  })

  it('rejects unsafe submitted changes with a message for the person saving', () => {
    const invalid = [
      { customColors: { primary: 'red' } },
      { customColors: { 'x;}': '1 1% 1%' } },
      { theme: 'sepia' },
      {
        customColors: Object.fromEntries(
          Array.from({ length: MAX_LEGACY_COLORS + 1 }, (_, index) => [
            `c${index}`,
            '1 1% 1%',
          ])
        ),
      },
    ]
    for (const appearance of invalid) {
      const result = legacyAppearanceUpdateSchema.safeParse(appearance)
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toMatch(/^(Classic|Choose dark)/)
    }
    expect(
      legacyAppearanceUpdateSchema.safeParse({
        theme: 'system',
        favicon: '/api/favicon',
        customColors: { primary: '#1e293b', ring: '212.7 26.8% 83.9%' },
      }).success
    ).toBe(true)
  })

  it('cannot close the server-rendered style element or add rules', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.appearance.customColors = {
      primary:
        '#fff} body{background:url(https://attacker.test/beacon)} :root{--x:#000',
      accent: '1 1% 1%;}</style><script>document.title=1</script><style>',
    }
    const html = renderToStaticMarkup(
      createElement('style', {
        dangerouslySetInnerHTML: { __html: initialThemeStyles(config) },
      })
    )
    expect(html.match(/<\/style>/g)).toHaveLength(1)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('attacker.test')
    expect(html).toContain('--primary: 210 40% 98%;')
  })
})
