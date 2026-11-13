import { describe, expect, it, vi } from 'vitest'

import { personalThemeMode } from '@/components/customization/appearance-provider'

import { personalAppearanceSchema } from '@/lib/customization/schema'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'loading' }),
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: () => {} }) }))
vi.mock('@/hooks/use-account-query', () => ({ useAccountQuery: () => ({}) }))

/** What the provider read from the schema before it read the reply by hand. */
function fromSchema(preference: unknown) {
  const result = personalAppearanceSchema.safeParse(preference)
  return result.success ? result.data.themeMode : null
}

describe('personalThemeMode', () => {
  it.each([
    [{ themeMode: 'inherit' }],
    [{ themeMode: 'system' }],
    [{ themeMode: 'light' }],
    [{ themeMode: 'dark' }],
    // A preference saved before the mode existed.
    [{}],
    [{ themeMode: undefined }],
    [{ themeMode: 'sepia' }],
    [{ themeMode: null }],
    [{ themeMode: 1 }],
    [{ themeMode: 'toString' }],
    [{ themeMode: 'dark', accent: '#ffffff' }],
    [{ accent: '#ffffff' }],
    [['dark']],
    [[]],
    ['dark'],
    [null],
    [undefined],
    [0],
  ])('reads %j as the schema does', (preference) => {
    expect(personalThemeMode(preference)).toBe(fromSchema(preference))
  })

  it('reads each mode and falls back to inherit', () => {
    expect(personalThemeMode({ themeMode: 'dark' })).toBe('dark')
    expect(personalThemeMode({})).toBe('inherit')
    expect(personalThemeMode({ themeMode: 'sepia' })).toBeNull()
    expect(personalThemeMode(undefined)).toBeNull()
  })
})
