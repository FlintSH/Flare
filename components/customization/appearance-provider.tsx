'use client'

import { createContext, useContext, useEffect } from 'react'

import { usePathname } from 'next/navigation'

import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'

import {
  type AppearanceDocument,
  DEFAULT_APPEARANCE,
  personalAppearanceSchema,
} from '@/lib/customization/schema'

import { useAccountQuery } from '@/hooks/use-account-query'

/** The account query that holds the signed-in person's own appearance choice. */
export const PERSONAL_APPEARANCE = 'appearance-preference'

const AppearanceContext = createContext<AppearanceDocument>(DEFAULT_APPEARANCE)
export const useAppearance = () => useContext(AppearanceContext)

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
  const preference = personalAppearanceSchema.safeParse(
    useAccountQuery<{ data?: unknown }>(
      PERSONAL_APPEARANCE,
      '/api/customization/preferences',
      { whole: true, retry: false }
    ).data?.data
  )
  const personalMode = preference.success ? preference.data.themeMode : null

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
