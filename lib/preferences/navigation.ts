export const SETTINGS_SECTIONS = [
  'general',
  'access',
  'storage',
  'appearance',
  'email',
  'advanced',
  'about',
] as const

export const PROFILE_SECTIONS = [
  'account',
  'appearance',
  'uploads',
  'integrations',
  'security',
  'data',
] as const

export function readPreferenceSection<T extends string>(
  value: string | string[] | undefined | null,
  sections: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && sections.includes(value as T)
    ? (value as T)
    : fallback
}
