import { describe, expect, it } from 'vitest'

import {
  DEFAULT_APPEARANCE,
  appearanceDocumentSchema,
} from '@/lib/customization/schema'
import {
  SETUP_APPEARANCE_PRESETS,
  createSetupAppearance,
} from '@/lib/setup/appearance'

describe('setup appearance choices', () => {
  it('keeps the original Flare theme when only the name and tagline change', () => {
    const document = createSetupAppearance(DEFAULT_APPEARANCE, {
      name: 'My Flare',
      tagline: 'A space for my screenshots.',
      preset: 'flare',
    })
    expect(document.theme).toEqual(DEFAULT_APPEARANCE.theme)
    expect(document.theme.enabled).toBe(false)
    expect(document.brand.name).toBe('My Flare')
    expect(document.sharing).toEqual(DEFAULT_APPEARANCE.sharing)
    expect(DEFAULT_APPEARANCE.brand.name).toBe('Flare')
  })

  it('preserves a published custom theme and unexposed fields on resume', () => {
    const published = structuredClone(DEFAULT_APPEARANCE)
    published.theme.enabled = true
    published.theme.dark.primary = '#123456'
    published.theme.font = 'mono'
    published.brand.footerText = 'An existing footer'
    published.sharing.titleTemplate = '{{filename}} on {{instanceName}}'
    const document = createSetupAppearance(published, {
      name: 'A new name',
      tagline: 'A new tagline',
      preset: 'current',
    })
    expect(document).toEqual({
      ...published,
      brand: {
        ...published.brand,
        name: 'A new name',
        tagline: 'A new tagline',
      },
    })
    expect(document.theme).not.toBe(published.theme)
  })

  it.each(SETUP_APPEARANCE_PRESETS.filter((preset) => preset.id !== 'flare'))(
    'previews $name without mutating the published appearance',
    (preset) => {
      const published = structuredClone(DEFAULT_APPEARANCE)
      published.theme.radius = 1.25
      published.theme.background = 'grid'
      published.theme.font = 'mono'
      published.sharing.defaultStyle = 'delivery'
      const unchanged = structuredClone(published)
      const document = createSetupAppearance(published, {
        name: published.brand.name,
        tagline: published.brand.tagline,
        preset: preset.id,
      })
      expect(appearanceDocumentSchema.safeParse(document).success).toBe(true)
      expect(document.theme.enabled).toBe(true)
      expect(document.theme.dark.primary).toBe(preset.accent)
      expect(document.theme.light.primary).toBe(preset.lightAccent)
      expect(document.theme.radius).toBe(1.25)
      expect(document.theme.background).toBe('grid')
      expect(document.theme.font).toBe('mono')
      expect(document.sharing).toEqual(published.sharing)
      expect(published).toEqual(unchanged)
    }
  )

  it('returns to the original Flare theme after trying a preset', () => {
    const preview = createSetupAppearance(DEFAULT_APPEARANCE, {
      name: 'My Flare',
      tagline: '',
      preset: 'orbit',
    })
    const document = createSetupAppearance(preview, {
      name: preview.brand.name,
      tagline: preview.brand.tagline,
      preset: 'flare',
    })
    expect(document.theme.enabled).toBe(false)
    expect(document.brand.name).toBe('My Flare')
  })
})
