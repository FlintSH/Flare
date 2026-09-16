import { describe, expect, it } from 'vitest'

import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_ALIASES,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ALIASES,
  readPreferenceSection,
  resolvePreferenceUrl,
} from '@/lib/preferences/navigation'

describe('preference link normalization', () => {
  it.each([
    ['appearance', 'workspace-appearance'],
    ['security', 'password'],
  ])(
    'keeps a saved profile %s link on its original card',
    (section, anchor) => {
      const input = new URL(
        `https://flare.example/dashboard/profile?section=${section}&source=bookmark`
      )
      const result = resolvePreferenceUrl(
        input,
        PROFILE_SECTIONS,
        'account',
        PROFILE_SECTION_ALIASES
      )
      expect(result.section).toBe('account')
      expect(result.url.pathname + result.url.search + result.url.hash).toBe(
        `/dashboard/profile?section=account&source=bookmark#${anchor}`
      )
      expect(input.searchParams.get('section')).toBe(section)
    }
  )

  it.each([
    ['advanced', 'appearance', 'advanced-styles'],
    ['about', 'general', 'instance-information'],
  ])('preserves recovery when resolving %s', (legacy, section, anchor) => {
    const { url, section: selected } = resolvePreferenceUrl(
      new URL(
        `https://flare.example/dashboard/settings?section=${legacy}&recovery=1&source=help`
      ),
      SETTINGS_SECTIONS,
      'general',
      SETTINGS_SECTION_ALIASES
    )
    expect(selected).toBe(section)
    expect(url.searchParams.get('recovery')).toBe('1')
    expect(url.searchParams.get('source')).toBe('help')
    expect(url.searchParams.get('section')).toBe(section)
    expect(url.hash).toBe(`#${anchor}`)
    expect(
      resolvePreferenceUrl(
        url,
        SETTINGS_SECTIONS,
        'general',
        SETTINGS_SECTION_ALIASES
      ).url.href
    ).toBe(url.href)
  })

  it('retains an explicitly requested card anchor', () => {
    const { url } = resolvePreferenceUrl(
      new URL(
        'https://flare.example/dashboard/settings?section=advanced&recovery=1#custom-css'
      ),
      SETTINGS_SECTIONS,
      'general',
      SETTINGS_SECTION_ALIASES
    )
    expect(url.hash).toBe('#custom-css')
    expect(url.searchParams.get('section')).toBe('appearance')
  })

  it.each([
    undefined,
    null,
    '',
    'constructor',
    '__proto__',
    'https://untrusted.example',
    'advanced&recovery=1',
    ['advanced', 'appearance'],
  ])('rejects invalid section values: %j', (value) => {
    expect(
      readPreferenceSection(
        value,
        SETTINGS_SECTIONS,
        'general',
        SETTINGS_SECTION_ALIASES
      )
    ).toBe('general')
  })

  it('matches server fallback for repeated section parameters', () => {
    const { section, url } = resolvePreferenceUrl(
      new URL(
        'https://flare.example/dashboard/settings?section=advanced&section=email&recovery=1'
      ),
      SETTINGS_SECTIONS,
      'general',
      SETTINGS_SECTION_ALIASES
    )
    expect(section).toBe('general')
    expect(url.hash).toBe('')
    expect(url.searchParams.getAll('section')).toEqual(['advanced', 'email'])
  })

  it('keeps canonical links and fragments unchanged', () => {
    const input = new URL(
      'https://flare.example/dashboard/profile?section=account#workspace-appearance'
    )
    expect(
      resolvePreferenceUrl(
        input,
        PROFILE_SECTIONS,
        'account',
        PROFILE_SECTION_ALIASES
      )
    ).toEqual({ section: 'account', url: input })
  })
})
