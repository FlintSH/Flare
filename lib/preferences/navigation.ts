export const SETTINGS_SECTIONS = [
  'general',
  'access',
  'storage',
  'appearance',
  'email',
] as const

export const PROFILE_SECTIONS = [
  'account',
  'uploads',
  'integrations',
  'data',
] as const

export type PreferenceSectionAliases<T extends string> = Readonly<
  Record<string, { section: T; anchor: string }>
>

export const SETTINGS_SECTION_ALIASES = {
  advanced: { section: 'appearance', anchor: 'advanced-styles' },
  about: { section: 'general', anchor: 'instance-information' },
} as const satisfies PreferenceSectionAliases<
  (typeof SETTINGS_SECTIONS)[number]
>

export const PROFILE_SECTION_ALIASES = {
  appearance: { section: 'account', anchor: 'workspace-appearance' },
  security: { section: 'account', anchor: 'password' },
} as const satisfies PreferenceSectionAliases<(typeof PROFILE_SECTIONS)[number]>

function readSectionAlias<T extends string>(
  value: string | string[] | undefined | null,
  sections: readonly T[],
  aliases?: PreferenceSectionAliases<T>
) {
  if (
    typeof value !== 'string' ||
    sections.includes(value as T) ||
    !aliases ||
    !Object.hasOwn(aliases, value)
  )
    return undefined
  const alias = aliases[value]
  return sections.includes(alias.section) ? alias : undefined
}

export function readPreferenceSection<T extends string>(
  value: string | string[] | undefined | null,
  sections: readonly T[],
  fallback: T,
  aliases?: PreferenceSectionAliases<T>
): T {
  return typeof value === 'string' && sections.includes(value as T)
    ? (value as T)
    : (readSectionAlias(value, sections, aliases)?.section ?? fallback)
}

export function resolvePreferenceUrl<T extends string>(
  input: URL,
  sections: readonly T[],
  fallback: T,
  aliases?: PreferenceSectionAliases<T>
) {
  const url = new URL(input)
  const values = url.searchParams.getAll('section')
  // Match the server's rejection of repeated query parameters.
  const value = values.length > 1 ? values : values[0]
  const section = readPreferenceSection(value, sections, fallback, aliases)
  const alias = readSectionAlias(value, sections, aliases)
  if (alias) {
    url.searchParams.set('section', section)
    if (!url.hash) url.hash = alias.anchor
  }
  return { section, url }
}
