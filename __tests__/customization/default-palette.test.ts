import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import {
  SUPERSEDED_DARK_PALETTES,
  defaultDarkPalette,
} from '@/lib/customization/defaults'
import { PALETTE_PRESETS, presetPalettes } from '@/lib/customization/presets'
import {
  DARK_PALETTE,
  DEFAULT_APPEARANCE,
  appearancePackSchema,
  customizationSchema,
} from '@/lib/customization/schema'
import { themeStyles } from '@/lib/customization/theme'

// The dark palettes earlier Flare versions shipped, copied from their commits
// so a change to the list is deliberate.
const FIRST_DEFAULT = {
  background: '#020817',
  foreground: '#f8fafc',
  card: '#020817',
  cardForeground: '#f8fafc',
  popover: '#020817',
  popoverForeground: '#f8fafc',
  primary: '#f8fafc',
  primaryForeground: '#0f172a',
  secondary: '#1e293b',
  secondaryForeground: '#f8fafc',
  muted: '#1e293b',
  mutedForeground: '#94a3b8',
  accent: '#1e293b',
  accentForeground: '#f8fafc',
  destructive: '#991b1b',
  destructiveForeground: '#f8fafc',
  border: '#1e293b',
  input: '#1e293b',
  ring: '#cbd5e1',
}
const LIFTED_DEFAULT = {
  ...FIRST_DEFAULT,
  card: '#0c1426',
  popover: '#162036',
  secondary: '#33445f',
  muted: '#26334d',
  mutedForeground: '#a8b5c9',
  accent: '#33445f',
  border: '#303f59',
  input: '#3a4a63',
}
const EARLIER = [FIRST_DEFAULT, LIFTED_DEFAULT]
const MIDNIGHT = presetPalettes(PALETTE_PRESETS.midnight).dark

function enabledTheme(dark: typeof DARK_PALETTE) {
  return {
    ...DEFAULT_APPEARANCE,
    theme: { ...DEFAULT_APPEARANCE.theme, enabled: true, dark },
  }
}

describe('default studio dark palette upgrade', () => {
  it('recognizes exactly the earlier defaults', () => {
    expect(SUPERSEDED_DARK_PALETTES).toEqual(EARLIER)
    for (const earlier of EARLIER) expect(earlier).not.toEqual(DARK_PALETTE)
  })

  it.each(EARLIER)(
    'moves untouched earlier default %# to the current one',
    (earlier) => {
      expect(defaultDarkPalette({ ...earlier })).toEqual(DARK_PALETTE)
      // Midnight is the default with the primary colour as its focus ring.
      expect(defaultDarkPalette({ ...earlier, ring: earlier.primary })).toEqual(
        MIDNIGHT
      )
      // Hex case doesn't make a palette custom.
      const upper = Object.fromEntries(
        Object.entries(earlier).map(([key, value]) => [
          key,
          value.toUpperCase(),
        ])
      ) as typeof DARK_PALETTE
      expect(defaultDarkPalette(upper)).toEqual(DARK_PALETTE)
    }
  )

  it.each(EARLIER)(
    'keeps earlier default %# once any colour changed',
    (earlier) => {
      const card = { ...earlier, card: '#123456' }
      expect(defaultDarkPalette(card)).toBe(card)
      const ring = { ...earlier, ring: '#a78bfa' }
      expect(defaultDarkPalette(ring)).toBe(ring)
    }
  )

  it('leaves the current default, Midnight and the other presets alone', () => {
    expect(defaultDarkPalette(DARK_PALETTE)).toBe(DARK_PALETTE)
    expect(defaultDarkPalette(MIDNIGHT)).toBe(MIDNIGHT)
    for (const preset of Object.values(PALETTE_PRESETS)) {
      const { dark } = presetPalettes(preset)
      expect(defaultDarkPalette(dark)).toBe(dark)
    }
  })

  it('upgrades saved published, draft, previous and imported themes', () => {
    const published = enabledTheme({ ...LIFTED_DEFAULT })
    const draft = enabledTheme({ ...FIRST_DEFAULT, ring: '#f8fafc' })
    const custom = enabledTheme({ ...FIRST_DEFAULT, background: '#000000' })
    const state = customizationSchema.parse({
      revision: 3,
      published,
      draft,
      previous: custom,
    })
    expect(state.published.theme.dark).toEqual(DARK_PALETTE)
    expect(state.draft?.theme.dark).toEqual(MIDNIGHT)
    expect(state.previous?.theme.dark).toEqual(custom.theme.dark)

    const pack = appearancePackSchema.parse({
      kind: 'flare.appearance',
      version: 1,
      name: 'Old pack',
      appearance: published,
    })
    expect(pack.appearance.theme.dark).toEqual(DARK_PALETTE)
  })

  it('renders the current default for a saved instance that kept the old one', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.customization.published = enabledTheme({
      ...LIFTED_DEFAULT,
    })
    const read = configSchema.parse(config).settings.customization.published
    expect(read.theme.dark).toEqual(DARK_PALETTE)
    expect(themeStyles(read)).toContain('--card:219.1 74.2% 6.1%')
  })
})
