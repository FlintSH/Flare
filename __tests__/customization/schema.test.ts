import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOMIZATION,
  appearanceDocumentSchema,
  appearancePackSchema,
  readPersonalAppearance,
  resolveShareStyle,
} from '@/lib/customization/schema'
import { shareMetadataText } from '@/lib/customization/sharing'
import {
  exportAppearancePack,
  transitionAppearance,
} from '@/lib/customization/state'
import { themeStyles } from '@/lib/customization/theme'

describe('appearance migration and portable packs', () => {
  it('preserves legacy appearance while adding disabled studio defaults', () => {
    const legacy = structuredClone(DEFAULT_CONFIG)
    delete (legacy.settings as Partial<typeof legacy.settings>).customization
    legacy.settings.appearance.customColors.primary = '120 50% 50%'
    legacy.settings.advanced.customCSS = '.special { color: hotpink }'
    const migrated = configSchema.parse(legacy)
    expect(migrated.settings.appearance).toEqual(legacy.settings.appearance)
    expect(migrated.settings.advanced).toEqual(legacy.settings.advanced)
    expect(migrated.settings.customization.published.theme.enabled).toBe(false)
    expect(migrated.settings.customization.published.sharing.defaultStyle).toBe(
      'framed'
    )
    expect(
      migrated.settings.customization.published.sharing.showFooter
    ).toBeNull()
  })

  it('round-trips a pack through a draft without changing the published design', () => {
    const design = structuredClone(DEFAULT_APPEARANCE)
    design.brand.name = 'Orbit'
    design.theme.enabled = true
    design.theme.dark.primary = '#a78bfa'
    const pack = appearancePackSchema.parse(
      JSON.parse(JSON.stringify(exportAppearancePack(design)))
    )
    const imported = transitionAppearance(DEFAULT_CUSTOMIZATION, {
      action: 'import',
      revision: 0,
      pack,
    })
    expect(imported.draft).toEqual(design)
    expect(imported.published).toEqual(DEFAULT_APPEARANCE)
    expect(imported.previous).toBeNull()
  })

  it('rejects credentials, executable fields, unknown versions and externally fetched logos', () => {
    const pack = exportAppearancePack(DEFAULT_APPEARANCE)
    expect(
      appearancePackSchema.safeParse({ ...pack, password: 'secret' }).success
    ).toBe(false)
    expect(
      appearancePackSchema.safeParse({ ...pack, version: 2 }).success
    ).toBe(false)
    expect(
      appearancePackSchema.safeParse({
        ...pack,
        appearance: {
          ...pack.appearance,
          customHead: '<script>alert(1)</script>',
        },
      }).success
    ).toBe(false)
    for (const logoLight of [
      'https://example.com/tracker.png',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,PHN2Zz4=',
    ]) {
      expect(
        appearanceDocumentSchema.safeParse({
          ...DEFAULT_APPEARANCE,
          brand: { ...DEFAULT_APPEARANCE.brand, logoLight },
        }).success
      ).toBe(false)
    }
    expect(
      appearanceDocumentSchema.safeParse({
        ...DEFAULT_APPEARANCE,
        theme: {
          ...DEFAULT_APPEARANCE.theme,
          dark: {
            ...DEFAULT_APPEARANCE.theme.dark,
            primary: '</style><script>alert(1)</script>',
          },
        },
      }).success
    ).toBe(false)
  })

  it('requires valid template placeholders and bounds presentation settings', () => {
    const design = structuredClone(DEFAULT_APPEARANCE)
    design.sharing.titleTemplate = '{{filename}} · {{instanceName}}'
    expect(appearanceDocumentSchema.safeParse(design).success).toBe(true)
    for (const titleTemplate of [
      '{{password}}',
      '{{user.email}}',
      '{{filename}',
      '{filename}',
    ]) {
      expect(
        appearanceDocumentSchema.safeParse({
          ...design,
          sharing: { ...design.sharing, titleTemplate },
        }).success
      ).toBe(false)
    }
    expect(
      appearanceDocumentSchema.safeParse({
        ...design,
        theme: { ...design.theme, radius: -1 },
      }).success
    ).toBe(false)
  })
})

describe('appearance publication', () => {
  it('publishes atomically, retains a prior revision, and can restore it', () => {
    const document = structuredClone(DEFAULT_APPEARANCE)
    document.brand.name = 'Orbit'
    const saved = transitionAppearance(DEFAULT_CUSTOMIZATION, {
      action: 'save',
      revision: 0,
      document,
    })
    const published = transitionAppearance(
      saved,
      { action: 'publish', revision: 1, document },
      '2026-09-13T10:00:00.000Z'
    )
    expect(published.published.brand.name).toBe('Orbit')
    expect(published.draft).toBeNull()
    expect(published.previous).toEqual(DEFAULT_APPEARANCE)
    const restored = transitionAppearance(published, {
      action: 'restore',
      revision: 2,
    })
    expect(restored.published).toEqual(DEFAULT_APPEARANCE)
    expect(restored.previous?.brand.name).toBe('Orbit')
    expect(restored.revision).toBe(3)
  })

  it('rejects stale saves and restores without history', () => {
    expect(() =>
      transitionAppearance(
        { ...DEFAULT_CUSTOMIZATION, revision: 2 },
        { action: 'save', revision: 1, document: DEFAULT_APPEARANCE }
      )
    ).toThrow('another tab')
    expect(() =>
      transitionAppearance(DEFAULT_CUSTOMIZATION, {
        action: 'restore',
        revision: 0,
      })
    ).toThrow('no previous')
  })

  it('discards only the draft', () => {
    const saved = transitionAppearance(DEFAULT_CUSTOMIZATION, {
      action: 'save',
      revision: 0,
      document: {
        ...DEFAULT_APPEARANCE,
        brand: { ...DEFAULT_APPEARANCE.brand, name: 'Unpublished' },
      },
    })
    expect(
      transitionAppearance(saved, { action: 'discard', revision: 1 }).published
    ).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('public disclosure and personal scope', () => {
  it('omits hidden fields from both automatic and custom social text', () => {
    const design = structuredClone(DEFAULT_APPEARANCE)
    design.sharing.showUploader = false
    design.sharing.showFilename = false
    design.sharing.showSize = false
    const file = {
      name: 'confidential.png',
      formattedSize: '123 MB',
      uploader: 'Private Person',
      isMedia: true,
    }
    const automatic = shareMetadataText(design, file)
    expect(JSON.stringify(automatic)).not.toMatch(
      /confidential|123 MB|Private Person/
    )
    design.sharing.titleTemplate =
      '{{instanceName}} {{filename}} {{uploader}} {{size}}'
    const custom = shareMetadataText(design, file)
    expect(custom.title).toBe('Flare')
    expect(custom.alt).toBe('Shared file')
  })

  it('uses only supported file profile styles and keeps absent preferences inherited', () => {
    expect(resolveShareStyle({ shareStyle: 'minimal' }, 'framed')).toBe(
      'minimal'
    )
    expect(resolveShareStyle({ shareStyle: 'unknown' }, 'delivery')).toBe(
      'delivery'
    )
    expect(
      readPersonalAppearance({ uploadProfiles: { default: 'one' } })
    ).toEqual({ themeMode: 'inherit' })
    expect(
      readPersonalAppearance({ customization: { themeMode: 'light' } })
    ).toEqual({ themeMode: 'light' })
  })

  it('keeps legacy dark variables untouched and supports an explicit personal light choice', () => {
    const css = themeStyles(DEFAULT_APPEARANCE)
    expect(css.startsWith('.light{')).toBe(true)
    expect(css).not.toContain(':root')
    expect(css).not.toContain('.dark')
    const themed = themeStyles({
      ...DEFAULT_APPEARANCE,
      theme: { ...DEFAULT_APPEARANCE.theme, enabled: true },
    })
    expect(themed).toContain('.dark{')
    expect(themed).toContain('--primary:')
  })
})
