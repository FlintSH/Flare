import { describe, expect, it } from 'vitest'

import { configSchema } from '@/lib/config'
import {
  DEFAULT_APPEARANCE,
  appearanceDocumentSchema,
} from '@/lib/customization/schema'
import {
  DEFAULT_EMBED_CARD,
  DEFAULT_PERSONAL_EMBED,
  embedLayout,
  personalEmbedSchema,
  readPersonalEmbed,
  resolveEmbedSettings,
} from '@/lib/embeds/schema'

// The sharing section as every release before embeds saved it.
const legacySharing = {
  defaultStyle: 'framed',
  showUploader: true,
  showFilename: true,
  showSize: true,
  showFooter: null,
  imageFit: 'contain',
  titleTemplate: '',
  descriptionTemplate: '',
}

describe('instance embed settings', () => {
  it('start as direct media with the card Flare always showed', () => {
    expect(DEFAULT_APPEARANCE.sharing).toMatchObject({
      embedMode: 'direct',
      personalEmbeds: true,
      siteNameTemplate: '{{instanceName}}',
      authorTemplate: '',
      titleTemplate: '{{filename}} ({{size}})',
      descriptionTemplate: 'Uploaded by {{uploader}}',
      embedColor: '',
    })
    expect(appearanceDocumentSchema.parse(DEFAULT_APPEARANCE)).toEqual(
      DEFAULT_APPEARANCE
    )
  })

  it('writes out the automatic text of an appearance saved before embeds', () => {
    const parsed = appearanceDocumentSchema.parse({
      ...DEFAULT_APPEARANCE,
      sharing: legacySharing,
    })
    expect(parsed.sharing).toEqual(DEFAULT_APPEARANCE.sharing)
  })

  it('keeps the wording an earlier appearance chose', () => {
    const parsed = appearanceDocumentSchema.parse({
      ...DEFAULT_APPEARANCE,
      sharing: { ...legacySharing, titleTemplate: '{{filename}} on Orbit' },
    })
    expect(parsed.sharing).toMatchObject({
      titleTemplate: '{{filename}} on Orbit',
      descriptionTemplate: DEFAULT_EMBED_CARD.description,
    })
    // As long as an earlier appearance could save, which must still load.
    const long = 'x'.repeat(500)
    expect(
      appearanceDocumentSchema.parse({
        ...DEFAULT_APPEARANCE,
        sharing: {
          ...legacySharing,
          titleTemplate: long,
          descriptionTemplate: long,
        },
      }).sharing
    ).toMatchObject({ titleTemplate: long, descriptionTemplate: long })
  })

  it('reads settings saved before embeds without changing other sections', () => {
    const config = configSchema.parse({
      version: '1.0.0',
      settings: {
        customization: {
          published: { ...DEFAULT_APPEARANCE, sharing: legacySharing },
        },
        general: {
          setup: {},
          registrations: { enabled: true, disabledMessage: '' },
          storage: {
            s3: { endpoint: '' },
            quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
            maxUploadSize: { value: 100, unit: 'MB' },
          },
          credits: { showFooter: true },
          ocr: {},
        },
        appearance: { favicon: null },
        advanced: { customCSS: '', customHead: '' },
      },
    })
    expect(config.settings.customization.published).toEqual(DEFAULT_APPEARANCE)
  })

  it('lets a line saved since then stay empty, which leaves it off the card', () => {
    const parsed = appearanceDocumentSchema.parse({
      ...DEFAULT_APPEARANCE,
      sharing: { ...DEFAULT_APPEARANCE.sharing, descriptionTemplate: '' },
    })
    expect(parsed.sharing.descriptionTemplate).toBe('')
  })

  it('refuses unknown placeholders, long lines and colors that are not hex', () => {
    const sharing = DEFAULT_APPEARANCE.sharing
    for (const change of [
      { siteNameTemplate: '{{password}}' },
      { authorTemplate: '{{user.email}}' },
      { titleTemplate: 'x'.repeat(501) },
      { descriptionTemplate: 'x'.repeat(501) },
      { embedColor: 'red' },
      { embedColor: '#fff' },
      { embedMode: 'fancy' },
    ])
      expect(
        appearanceDocumentSchema.safeParse({
          ...DEFAULT_APPEARANCE,
          sharing: { ...sharing, ...change },
        }).success,
        JSON.stringify(change)
      ).toBe(false)
  })
})

describe('personal embed settings', () => {
  it('follow the instance until an account chooses otherwise', () => {
    expect(DEFAULT_PERSONAL_EMBED).toEqual({
      mode: 'inherit',
      design: 'inherit',
      siteName: '',
      author: '',
      title: '',
      description: '',
      color: '',
    })
    expect(readPersonalEmbed(null)).toEqual(DEFAULT_PERSONAL_EMBED)
    expect(readPersonalEmbed({ customization: { themeMode: 'dark' } })).toEqual(
      DEFAULT_PERSONAL_EMBED
    )
    // Unreadable saved settings fall back rather than break a share link.
    expect(readPersonalEmbed({ embed: { mode: 'loud' } })).toEqual(
      DEFAULT_PERSONAL_EMBED
    )
  })

  it('accept only the fields and placeholders the card has', () => {
    expect(
      personalEmbedSchema.safeParse({ mode: 'rich', title: '{{filename}}' })
        .success
    ).toBe(true)
    for (const body of [
      { mode: 'rich', title: '{{password}}' },
      { mode: 'rich', color: 'javascript:alert(1)' },
      { mode: 'rich', html: '<b>hi</b>' },
      { design: 'mine' },
    ])
      expect(
        personalEmbedSchema.safeParse(body).success,
        JSON.stringify(body)
      ).toBe(false)
  })

  it('override the mode and the card separately', () => {
    const sharing = { ...DEFAULT_APPEARANCE.sharing, embedColor: '#112233' }
    const instance = {
      siteName: '{{instanceName}}',
      author: '',
      title: '{{filename}} ({{size}})',
      description: 'Uploaded by {{uploader}}',
      color: '#112233',
    }
    expect(resolveEmbedSettings(sharing, null)).toEqual({
      mode: 'direct',
      card: instance,
    })
    expect(
      resolveEmbedSettings(sharing, { ...DEFAULT_PERSONAL_EMBED, mode: 'rich' })
    ).toEqual({ mode: 'rich', card: instance })
    const own = {
      ...DEFAULT_PERSONAL_EMBED,
      design: 'custom' as const,
      title: '{{filename}}',
    }
    expect(resolveEmbedSettings(sharing, own)).toEqual({
      mode: 'direct',
      card: {
        siteName: '',
        author: '',
        title: '{{filename}}',
        description: '',
        color: '',
      },
    })
    expect(
      resolveEmbedSettings({ ...sharing, personalEmbeds: false }, own)
    ).toEqual({ mode: 'direct', card: instance })
  })
})

describe('what an app that shows media on its own is given', () => {
  it('is the file or its player in direct mode, and the card otherwise', () => {
    expect(embedLayout('direct', 'image', true)).toBe('media')
    expect(embedLayout('direct', 'video', true)).toBe('player')
    expect(embedLayout('direct', 'audio', true)).toBe('card')
    expect(embedLayout('direct', null, true)).toBe('card')
    expect(embedLayout('direct', 'image', false)).toBe('card')
    expect(embedLayout('rich', 'image', true)).toBe('card')
    expect(embedLayout('rich', 'video', true)).toBe('card')
  })
})
