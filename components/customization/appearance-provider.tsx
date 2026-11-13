'use client'

import { useEffect } from 'react'

import { usePathname } from 'next/navigation'

import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'

import { AppearanceContext } from '@/components/providers/appearance-context'

import type {
  AppearanceDocument,
  PersonalAppearance,
} from '@/lib/customization/schema'

import { useAccountQuery } from '@/hooks/use-account-query'

/** The account query that holds the signed-in person's own appearance choice. */
export const PERSONAL_APPEARANCE = 'appearance-preference'

type PersonalMode = PersonalAppearance['themeMode']

// Every mode an account can choose; a new one in the schema fails to compile
// here until it is listed.
const PERSONAL_MODES = {
  inherit: true,
  system: true,
  light: true,
  dark: true,
} satisfies Record<PersonalMode, true>

/**
 * The mode in a saved preference, or null when the reply isn't one. It reads
 * what `personalAppearanceSchema` accepts, by hand: this provider is on every
 * page, and the schema would bring its validator to all of them.
 */
export function personalThemeMode(preference: unknown): PersonalMode | null {
  if (
    !preference ||
    typeof preference !== 'object' ||
    Array.isArray(preference) ||
    Object.keys(preference).some((key) => key !== 'themeMode')
  )
    return null
  const { themeMode = 'inherit' } = preference as { themeMode?: unknown }
  return typeof themeMode === 'string' &&
    Object.hasOwn(PERSONAL_MODES, themeMode)
    ? (themeMode as PersonalMode)
    : null
}

export function AppearanceProvider({
  appearance,
  legacyTheme,
  children,
}: {
  appearance: AppearanceDocument
  legacyTheme: string
  children: React.ReactNode
}) {
  const { status } = useSession()
  const pathname = usePathname()
  const { setTheme } = useTheme()
  // The instance appearance stays if preferences are unavailable.
  const personalMode = personalThemeMode(
    useAccountQuery<{ data?: unknown }>(
      PERSONAL_APPEARANCE,
      '/api/customization/preferences',
      { whole: true, retry: false }
    ).data?.data
  )

  useEffect(() => {
    if (status === 'loading') return
    const instanceMode = appearance.theme.enabled
      ? appearance.theme.defaultMode
      : legacyTheme
    const mode =
      pathname.startsWith('/dashboard') &&
      personalMode &&
      personalMode !== 'inherit'
        ? personalMode
        : instanceMode
    setTheme(mode)
  }, [
    appearance.theme.defaultMode,
    appearance.theme.enabled,
    legacyTheme,
    pathname,
    personalMode,
    setTheme,
    status,
  ])

  return (
    <AppearanceContext.Provider value={appearance}>
      {children}
    </AppearanceContext.Provider>
  )
}
