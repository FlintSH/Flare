'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import { usePathname } from 'next/navigation'

import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'

import {
  type AppearanceDocument,
  DEFAULT_APPEARANCE,
  type PersonalAppearance,
  personalAppearanceSchema,
} from '@/lib/customization/schema'

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
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const { setTheme } = useTheme()
  const [preference, setPreference] = useState<PersonalAppearance>({
    themeMode: 'inherit',
  })
  const [preferenceOwner, setPreferenceOwner] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.user?.id) {
      setPreferenceOwner(null)
      return
    }
    let active = true
    const userId = session.user.id
    const refresh = async () => {
      try {
        const response = await fetch('/api/customization/preferences')
        if (!response.ok) return
        const body = await response.json()
        const parsed = personalAppearanceSchema.safeParse(body?.data)
        if (active && parsed.success) {
          setPreference(parsed.data)
          setPreferenceOwner(userId)
        }
      } catch {
        /* Keep the instance appearance if preferences are unavailable. */
      }
    }
    void refresh()
    window.addEventListener('flare:appearance-preference', refresh)
    return () => {
      active = false
      window.removeEventListener('flare:appearance-preference', refresh)
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (status === 'loading') return
    const instanceMode = appearance.theme.enabled
      ? appearance.theme.defaultMode
      : legacyTheme
    const mode =
      pathname.startsWith('/dashboard') &&
      preferenceOwner === session?.user?.id &&
      preference.themeMode !== 'inherit'
        ? preference.themeMode
        : instanceMode
    setTheme(mode)
  }, [
    appearance.theme.defaultMode,
    appearance.theme.enabled,
    legacyTheme,
    pathname,
    preference.themeMode,
    preferenceOwner,
    session?.user?.id,
    setTheme,
    status,
  ])

  return (
    <AppearanceContext.Provider value={appearance}>
      {children}
    </AppearanceContext.Provider>
  )
}
